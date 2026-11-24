"""Web content extraction.

Strategy per URL: robots.txt check -> Playwright/Chromium render (through the SSRF egress proxy)
-> fallback to plain SSRF-safe HTTP fetch -> GitHub API augmentation for repositories.
`parse_html()` is pure so it can be tested against fixtures without network access.
"""

import asyncio
import hashlib
import io
import json
import logging
import re
import time
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import trafilatura
from bs4 import BeautifulSoup
from PIL import Image

from app.config import settings
from app.fetch import FetchError, FetchResult, safe_get
from app.netguard import EgressProxy, UnsafeURL

log = logging.getLogger("cairn.extract")

MIN_USEFUL_TEXT = 200
MAX_MARKDOWN = 200_000
MAX_SNIPPETS = 25


class Blocked(Exception):
    """Site refuses automated access (robots.txt, CAPTCHA/challenge, login wall). Not retried."""


class PermanentError(Exception):
    """Will not succeed on retry (404, unsupported content type, ...)."""


@dataclass
class Extraction:
    method: str
    final_url: str
    http_status: int | None = None
    canonical_url: str | None = None
    title: str | None = None
    meta: dict = field(default_factory=dict)
    markdown: str = ""
    headings: list[str] = field(default_factory=list)
    code_snippets: list[dict] = field(default_factory=list)
    tech_stack: list[str] = field(default_factory=list)
    github: dict | None = None
    screenshot: bytes | None = None
    favicon_url: str | None = None
    redirects: list[str] = field(default_factory=list)
    partial: bool = False
    notes: list[str] = field(default_factory=list)

    @property
    def text_length(self) -> int:
        return len(self.markdown)

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.markdown.encode()).hexdigest()


# ---------------------------------------------------------------- HTML parsing (pure)

TECH_SIGNATURES: list[tuple[str, str, str]] = [
    # (name, where: html|header, regex)
    ("Next.js", "html", r"__NEXT_DATA__|/_next/static/"),
    ("Nuxt", "html", r"__NUXT__|/_nuxt/"),
    ("Gatsby", "html", r"___gatsby"),
    ("Astro", "html", r"astro-island|/_astro/"),
    ("SvelteKit", "html", r"__sveltekit|/_app/immutable/"),
    ("Remix", "html", r"__remixContext"),
    ("React", "html", r"data-reactroot|react-dom|__NEXT_DATA__"),
    ("Vue.js", "html", r"data-v-[0-9a-f]{6,}|vue(\.runtime)?(\.min)?\.js"),
    ("Angular", "html", r"ng-version="),
    ("WordPress", "html", r"wp-content/|wp-includes/"),
    ("Webflow", "html", r"webflow\.(com|js)|data-wf-page"),
    ("Framer", "html", r"framerusercontent\.com|__framer"),
    ("Wix", "html", r"static\.wixstatic\.com"),
    ("Squarespace", "html", r"squarespace\.com|static1\.squarespace"),
    ("Shopify", "html", r"cdn\.shopify\.com|Shopify\.theme"),
    ("Ghost", "html", r'content="Ghost \d'),
    ("Docusaurus", "html", r"docusaurus"),
    ("GitBook", "html", r"gitbook"),
    ("Mintlify", "html", r"mintlify"),
    ("Tailwind CSS", "html", r"\b(?:tw-|bg-(?:white|black|gray-\d{2,3})\s+(?:text|p|px|py|m|flex))"),
    ("Google Analytics", "html", r"googletagmanager\.com/gtag|google-analytics\.com"),
    ("Stripe", "html", r"js\.stripe\.com"),
    ("Intercom", "html", r"widget\.intercom\.io"),
    ("HubSpot", "html", r"js\.hs-scripts\.com|hubspot"),
    ("Vercel", "header", r"^x-vercel-id:"),
    ("Netlify", "header", r"^x-nf-request-id:|^server: netlify"),
    ("Cloudflare", "header", r"^cf-ray:"),
    ("Fastly", "header", r"^x-served-by: cache-"),
    ("nginx", "header", r"^server: nginx"),
]

_LANG_CLASS = re.compile(r"(?:language|lang|highlight-source|highlight)-([a-z0-9+#.-]+)", re.I)


def detect_tech(html: str, headers: dict[str, str] | None) -> list[str]:
    # shortcut: ~30 hand-written signatures; swap in Wappalyzer fingerprints if richer detection is needed
    header_lines = "\n".join(f"{k.lower()}: {v.lower()}" for k, v in (headers or {}).items())
    found = []
    sample = html[:400_000]
    for name, where, pattern in TECH_SIGNATURES:
        hay = sample if where == "html" else header_lines
        if re.search(pattern, hay, re.I | re.M):
            found.append(name)
    return found


def _meta(soup: BeautifulSoup, *keys: str) -> str | None:
    for key in keys:
        tag = soup.find("meta", attrs={"property": key}) or soup.find("meta", attrs={"name": key})
        if tag and tag.get("content"):
            return " ".join(tag["content"].split())[:2000]
    return None


def _pick_favicon(soup: BeautifulSoup, base: str) -> str:
    best, best_size = None, -1
    for link in soup.find_all("link", href=True):
        rel = " ".join(link.get("rel") or []).lower()
        if "icon" not in rel:
            continue
        href = link["href"]
        if href.startswith("data:") or href.lower().endswith(".svg"):
            continue  # SVG can't be safely rasterized/served
        sizes = link.get("sizes") or ""
        m = re.match(r"(\d+)x\d+", sizes)
        size = int(m.group(1)) if m else (180 if "apple-touch" in rel else 32)
        if 16 <= size <= 256 and size > best_size:
            best, best_size = href, size
    return urljoin(base, best) if best else urljoin(base, "/favicon.ico")


def extract_code_snippets(soup: BeautifulSoup) -> list[dict]:
    snippets, seen = [], set()
    for pos, pre in enumerate(soup.find_all("pre")):
        code_el = pre.find("code") or pre
        code = code_el.get_text("\n" if code_el is pre else "").strip("\n")
        if len(code) < 20 or ("\n" not in code and len(code) < 40) or code in seen:
            continue
        seen.add(code)
        parent_classes = (pre.parent.get("class") or []) if pre.parent else []
        m = _LANG_CLASS.search(" ".join((code_el.get("class") or []) + (pre.get("class") or []) + parent_classes))
        heading = pre.find_previous(["h1", "h2", "h3", "h4"])
        snippets.append({
            "language": m.group(1).lower() if m else None,
            "code": code[:5000],
            "context": heading.get_text(" ", strip=True)[:200] if heading else None,
            "position": pos,
        })
        if len(snippets) >= MAX_SNIPPETS:
            break
    return snippets


def markdown_code_snippets(markdown: str) -> list[dict]:
    out = []
    for pos, m in enumerate(re.finditer(r"```([\w+#.-]*)\n(.*?)```", markdown, re.S)):
        code = m.group(2).strip("\n")
        if len(code) >= 20 and ("\n" in code or len(code) >= 40):
            heading = None
            for h in re.finditer(r"^#{1,4}\s+(.+)$", markdown[: m.start()], re.M):
                heading = h.group(1).strip()
            out.append({"language": (m.group(1) or None) and m.group(1).lower(), "code": code[:5000],
                        "context": heading, "position": pos})
        if len(out) >= MAX_SNIPPETS:
            break
    return out


def _text_to_markdown(text: str) -> str:
    """Rendered innerText -> paragraphs (fallback for JS apps where trafilatura finds no article)."""
    lines = [" ".join(line.split()) for line in text.splitlines()]
    blocks, seen = [], set()
    for line in lines:
        if len(line) < 3 or line in seen:
            continue
        seen.add(line)
        blocks.append(line)
    return "\n\n".join(blocks)


def parse_html(html: str, url: str, *, headers: dict[str, str] | None = None,
               rendered_text: str | None = None, method: str = "http") -> Extraction:
    soup = BeautifulSoup(html, "lxml")
    for bad in soup(["noscript", "template"]):
        bad.decompose()
    title = soup.title.get_text(" ", strip=True)[:500] if soup.title else None
    canonical = soup.find("link", rel="canonical", href=True)
    keywords = _meta(soup, "keywords")
    meta = {
        "description": _meta(soup, "description", "og:description", "twitter:description"),
        "og_title": _meta(soup, "og:title", "twitter:title"),
        "site_name": _meta(soup, "og:site_name", "application-name", "apple-mobile-web-app-title"),
        "image": _meta(soup, "og:image", "og:image:url", "twitter:image"),
        "type": _meta(soup, "og:type"),
        "keywords": [k.strip() for k in keywords.split(",") if k.strip()][:15] if keywords else [],
        "lang": (soup.html.get("lang") if soup.html else None),
    }
    if meta["image"]:
        meta["image"] = urljoin(url, meta["image"])
    # JSON-LD often has the cleanest product name/description/pricing for SaaS pages
    for ld in soup.find_all("script", type="application/ld+json")[:5]:
        try:
            data = json.loads(ld.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for item in items:
            if isinstance(item, dict) and item.get("@type") in ("SoftwareApplication", "WebApplication",
                                                                  "Product", "Organization", "WebSite"):
                meta.setdefault("jsonld", []).append(
                    {k: item.get(k) for k in ("@type", "name", "description", "offers", "applicationCategory")
                     if item.get(k)})
    headings = [h.get_text(" ", strip=True)[:200] for h in soup.find_all(["h1", "h2", "h3"])][:40]
    headings = [h for h in headings if h]
    snippets = extract_code_snippets(soup)
    for s in soup("script"):
        s.decompose()

    markdown = trafilatura.extract(
        html, url=url, output_format="markdown", include_links=True, include_tables=True,
        include_formatting=True, include_images=False, include_comments=False, favor_recall=True,
    ) or ""
    if len(markdown) < MIN_USEFUL_TEXT and rendered_text and len(rendered_text) > len(markdown):
        markdown = _text_to_markdown(rendered_text)
    if len(markdown) < MIN_USEFUL_TEXT:
        body_text = soup.body.get_text("\n") if soup.body else ""
        if len(body_text.strip()) > len(markdown):
            markdown = _text_to_markdown(body_text)
    return Extraction(
        method=method, final_url=url, canonical_url=urljoin(url, canonical["href"]) if canonical else None,
        title=title, meta=meta, markdown=markdown[:MAX_MARKDOWN], headings=headings, code_snippets=snippets,
        tech_stack=detect_tech(html, headers), favicon_url=_pick_favicon(soup, url),
    )


def detect_block(status: int | None, title: str | None, html: str, headers: dict[str, str]) -> str | None:
    """Return a human-readable reason if the page is a challenge / CAPTCHA / login wall."""
    h = {k.lower(): v for k, v in headers.items()}
    t = (title or "").strip().lower()
    if h.get("cf-mitigated") == "challenge" or t in ("just a moment...", "attention required! | cloudflare"):
        return "Protected by a Cloudflare challenge; automated access is not permitted"
    lower = html[:200_000].lower()
    small = len(lower) < 60_000
    if small and any(s in lower for s in ("g-recaptcha", "h-captcha", "cf-turnstile", "captcha-delivery")):
        return "The site requires solving a CAPTCHA"
    if status == 401:
        return "The page requires authentication (401)"
    if status == 403:
        return "Access denied by the site (403)"
    return None


# ---------------------------------------------------------------- robots.txt

_robots_cache: dict[str, tuple[float, RobotFileParser | None]] = {}


async def robots_allowed(url: str) -> bool:
    if not settings.respect_robots_txt:
        return True
    parts = urlsplit(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    cached = _robots_cache.get(origin)
    if not cached or time.time() - cached[0] > 3600:
        parser: RobotFileParser | None = None
        try:
            res = await safe_get(origin + "/robots.txt", accept="text/plain", max_bytes=500_000)
            if res.status == 200 and "html" not in res.content_type:
                parser = RobotFileParser()
                parser.parse(res.text.splitlines())
        except (FetchError, UnsafeURL):
            parser = None  # unreachable robots.txt = no restrictions stated
        _robots_cache[origin] = cached = (time.time(), parser)
    parser = cached[1]
    return parser is None or parser.can_fetch("CairnBot", url)


# ---------------------------------------------------------------- browser

HIDE_OVERLAYS_CSS = """
#onetrust-banner-sdk, #onetrust-consent-sdk, .cc-window, .cookie-banner, #cookie-banner, #cookieConsent,
[id*="cookie-consent" i], [class*="cookie-consent" i], [id^="CybotCookiebot"], #usercentrics-root,
.qc-cmp2-container, #truste-consent-track, .truste_box_overlay, [class*="CookieBanner"],
[aria-label*="cookie" i][role="dialog"], [id*="gdpr" i][class*="banner" i] { display: none !important; }
"""


class BrowserPool:
    """One Chromium per worker process, a fresh isolated context per page, recycled every N pages."""

    RECYCLE_AFTER = 150

    def __init__(self) -> None:
        self._pw = None
        self._browser = None
        self._uses = 0
        self._lock = asyncio.Lock()
        self.proxy = EgressProxy()

    async def get(self):
        from playwright.async_api import async_playwright

        async with self._lock:
            if self._browser is None or not self._browser.is_connected() or self._uses >= self.RECYCLE_AFTER:
                await self._close_browser()
                if not self.proxy.server:
                    await self.proxy.start()
                if self._pw is None:
                    self._pw = await async_playwright().start()
                self._browser = await self._pw.chromium.launch(
                    headless=True,
                    proxy={"server": f"http://127.0.0.1:{self.proxy.port}", "bypass": "<-loopback>"},
                    args=["--disable-dev-shm-usage", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                          "--disable-quic"],
                )
                self._uses = 0
            self._uses += 1
            return self._browser

    async def _close_browser(self) -> None:
        if self._browser is not None:
            try:
                await self._browser.close()
            except Exception:
                pass
            self._browser = None

    async def close(self) -> None:
        await self._close_browser()
        if self._pw is not None:
            await self._pw.stop()
            self._pw = None
        await self.proxy.close()


@dataclass
class RenderResult:
    html: str
    final_url: str
    status: int | None
    headers: dict[str, str]
    text: str
    screenshot: bytes | None
    redirects: list[str]


async def render(pool: BrowserPool, url: str) -> RenderResult:
    from playwright.async_api import TimeoutError as PWTimeout

    browser = await pool.get()
    context = await browser.new_context(
        viewport={"width": 1280, "height": 800}, user_agent=settings.user_agent, accept_downloads=False,
        service_workers="block", locale="en-US", ignore_https_errors=False,
    )
    try:
        page = await context.new_page()
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        try:
            await page.wait_for_load_state("networkidle", timeout=7_000)
        except PWTimeout:
            pass  # long-polling / analytics keep the network busy; DOM is usable
        try:  # SPAs: give the app a moment to put real text on screen
            await page.wait_for_function("document.body && document.body.innerText.length > 200",
                                         timeout=3_000)
        except PWTimeout:
            pass
        await page.add_style_tag(content=HIDE_OVERLAYS_CSS)
        await page.wait_for_timeout(300)
        html = await page.content()
        text = await page.evaluate("document.body ? document.body.innerText : ''")
        screenshot = None
        try:
            height = await page.evaluate("document.documentElement.scrollHeight")
            clip = {"x": 0, "y": 0, "width": 1280, "height": min(int(height or 800), 6000)}
            screenshot = await page.screenshot(full_page=True, clip=clip, type="jpeg", quality=80,
                                               timeout=15_000)
        except Exception as e:  # screenshot failure shouldn't lose the content
            log.warning("screenshot failed for %s: %s", url, e)
        redirects = []
        req = resp.request.redirected_from if resp else None
        while req is not None:
            redirects.insert(0, req.url)
            req = req.redirected_from
        return RenderResult(
            html=html, final_url=page.url, status=resp.status if resp else None,
            headers=await resp.all_headers() if resp else {}, text=text, screenshot=screenshot,
            redirects=redirects[1:] + [page.url] if redirects else [],
        )
    finally:
        await context.close()


# ---------------------------------------------------------------- images

def process_screenshot(raw: bytes) -> tuple[bytes, bytes]:
    """-> (compressed full screenshot JPEG, 640x400 hero thumbnail WebP)"""
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    if im.height > 6000:
        im = im.crop((0, 0, im.width, 6000))
    shot = io.BytesIO()
    im.save(shot, "JPEG", quality=70, optimize=True, progressive=True)
    top = im.crop((0, 0, im.width, min(im.height, int(im.width * 0.625))))
    top.thumbnail((640, 400))
    thumb = io.BytesIO()
    top.save(thumb, "WEBP", quality=78)
    return shot.getvalue(), thumb.getvalue()


async def fetch_favicon(url: str) -> bytes | None:
    """Download and re-encode as PNG (never serve third-party bytes/SVG from our origin)."""
    try:
        res = await safe_get(url, accept="image/*", max_bytes=300_000)
        if res.status != 200:
            return None
        im = Image.open(io.BytesIO(res.body))
        im.load()
        if getattr(im, "n_frames", 1) > 1:
            im.seek(0)
        im = im.convert("RGBA")
        im.thumbnail((64, 64))
        out = io.BytesIO()
        im.save(out, "PNG")
        return out.getvalue()
    except Exception:
        return None


# ---------------------------------------------------------------- GitHub

_GH_RESERVED = {"settings", "orgs", "topics", "features", "marketplace", "sponsors", "explore", "login",
                "about", "pricing", "enterprise", "collections", "trending", "apps", "users", "search",
                "notifications", "new", "organizations", "codespaces", "readme", "security", "site"}


def github_repo(url: str) -> tuple[str, str] | None:
    parts = urlsplit(url)
    if (parts.hostname or "").lower() not in ("github.com", "www.github.com"):
        return None
    segs = [s for s in parts.path.split("/") if s]
    if len(segs) < 2 or segs[0].lower() in _GH_RESERVED:
        return None
    return segs[0], segs[1].removesuffix(".git")


async def github_info(owner: str, repo: str) -> dict | None:
    base = f"https://api.github.com/repos/{owner}/{repo}"
    headers = {"X-GitHub-Api-Version": "2022-11-28"}
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token.get_secret_value()}"

    async def get_json(url: str):
        res = await safe_get(url, accept="application/vnd.github+json", extra_headers=headers)
        if res.status == 404:
            return None
        if res.status in (403, 429):
            raise FetchError("GitHub API rate limit reached (set GITHUB_TOKEN to raise it)")
        if res.status != 200:
            raise FetchError(f"GitHub API returned {res.status}")
        return json.loads(res.body)

    info = await get_json(base)
    if info is None:
        return None
    languages = await get_json(base + "/languages") or {}
    release = await get_json(base + "/releases/latest")
    readme_res = await safe_get(base + "/readme", accept="application/vnd.github.raw",
                                extra_headers=headers, max_bytes=1_000_000)
    readme = readme_res.text if readme_res.status == 200 else ""
    total = sum(languages.values()) or 1
    return {
        "full_name": info.get("full_name"),
        "description": info.get("description"),
        "homepage": info.get("homepage") or None,
        "stars": info.get("stargazers_count"),
        "forks": info.get("forks_count"),
        "open_issues": info.get("open_issues_count"),
        "watchers": info.get("subscribers_count"),
        "language": info.get("language"),
        "languages": {k: round(v * 100 / total, 1) for k, v in list(languages.items())[:8]},
        "license": (info.get("license") or {}).get("spdx_id") if info.get("license") else None,
        "topics": info.get("topics") or [],
        "archived": info.get("archived"),
        "default_branch": info.get("default_branch"),
        "created_at": info.get("created_at"),
        "pushed_at": info.get("pushed_at"),
        "latest_release": {"tag": release.get("tag_name"), "name": release.get("name"),
                           "published_at": release.get("published_at")} if release else None,
        "readme": readme[:MAX_MARKDOWN],
    }


# ---------------------------------------------------------------- orchestrator

def _fetch_result_status(res: FetchResult) -> None:
    if res.status in (404, 410):
        raise PermanentError(f"Page not found ({res.status})")
    if res.status == 429:
        raise FetchError("Rate limited by the site (429); will retry later")
    if res.status >= 500:
        raise FetchError(f"Server error ({res.status})")


async def extract(url: str, pool: BrowserPool | None) -> Extraction:
    if not await robots_allowed(url):
        raise Blocked("The site's robots.txt disallows automated access to this page "
                      "(set RESPECT_ROBOTS_TXT=false to override for personal use)")
    errors: list[str] = []
    gh = github_repo(url)
    github = None
    if gh:
        try:
            github = await github_info(*gh)
        except FetchError as e:
            errors.append(f"github: {e}")

    ext: Extraction | None = None
    block_reason = None
    if pool is not None and settings.browser_enabled:
        try:
            r = await render(pool, url)
            if r.status in (404, 410) and not github:
                raise PermanentError(f"Page not found ({r.status})")
            ext = parse_html(r.html, r.final_url, headers=r.headers, rendered_text=r.text, method="browser")
            ext.http_status, ext.screenshot, ext.redirects = r.status, r.screenshot, r.redirects
            block_reason = detect_block(r.status, ext.title, r.html, r.headers)
            if r.status and r.status >= 500:
                errors.append(f"browser: server error {r.status}")
                ext = None
            elif block_reason:
                errors.append(f"browser: {block_reason}")
        except (PermanentError, UnsafeURL):
            raise
        except Exception as e:
            msg = str(e).splitlines()[0][:300] if str(e) else type(e).__name__
            if "ERR_TUNNEL_CONNECTION_FAILED" in msg or "ERR_PROXY" in msg:
                msg = "connection refused by the egress proxy (non-public address or unreachable host)"
            errors.append(f"browser: {msg}")
            ext = None

    if ext is None or block_reason:
        # Lightweight fallback (also handles sites that block headless browsers but serve plain HTML)
        try:
            res = await safe_get(url)
            _fetch_result_status(res)
            if res.content_type and "html" not in res.content_type and "xml" not in res.content_type:
                if not github:
                    raise PermanentError(f"Not a web page ({res.content_type}); only HTML is extracted")
            else:
                headers = dict(res.headers)
                http_ext = parse_html(res.text, res.url, headers=headers, method="http")
                http_ext.http_status, http_ext.redirects = res.status, res.redirects
                http_block = detect_block(res.status, http_ext.title, res.text, headers)
                if not http_block:
                    shot = ext.screenshot if ext and not block_reason else None
                    ext, block_reason = http_ext, None
                    ext.screenshot = shot
                else:
                    block_reason = block_reason or http_block
        except (PermanentError, UnsafeURL):
            raise
        except FetchError as e:
            errors.append(f"http: {e}")

    if github:
        if ext is None or block_reason:
            ext = Extraction(method="github", final_url=url, http_status=200)
            block_reason = None
        ext.github = github
        ext.title = ext.title or github["full_name"]
        ext.meta.setdefault("description", github["description"])
        if not ext.meta.get("description"):
            ext.meta["description"] = github["description"]
        if github["readme"]:
            ext.markdown = github["readme"]
            ext.code_snippets = markdown_code_snippets(github["readme"]) or ext.code_snippets
        ext.favicon_url = ext.favicon_url or "https://github.com/favicon.ico"

    if block_reason:
        raise Blocked(block_reason)
    if ext is None:
        raise FetchError("; ".join(errors) or "Could not fetch the page")
    if ext.text_length < MIN_USEFUL_TEXT and not ext.meta.get("description"):
        ext.partial = True
        ext.notes.append("Very little readable content was found on the page")
    if errors:
        ext.notes.extend(errors)
    return ext
