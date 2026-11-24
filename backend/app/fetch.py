"""SSRF-safe HTTP fetching: every hop is resolved, checked, and the connection is pinned to the checked IP
(so DNS rebinding between check and connect is impossible). TLS is still verified against the hostname."""

from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from app.config import settings
from app.netguard import assert_public_url

MAX_REDIRECTS = 10


class FetchError(Exception):
    """Transient or network failure (worth retrying)."""


class TooLarge(FetchError):
    pass


@dataclass
class FetchResult:
    url: str  # final URL after redirects
    status: int
    headers: httpx.Headers
    body: bytes
    redirects: list[str] = field(default_factory=list)

    @property
    def content_type(self) -> str:
        return self.headers.get("content-type", "").split(";")[0].strip().lower()

    @property
    def text(self) -> str:
        enc = None
        ct = self.headers.get("content-type", "")
        if "charset=" in ct:
            enc = ct.split("charset=")[-1].split(";")[0].strip().strip('"')
        try:
            return self.body.decode(enc or "utf-8", errors="replace")
        except LookupError:
            return self.body.decode("utf-8", errors="replace")


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(follow_redirects=False, timeout=settings.fetch_timeout_seconds,
                             headers={"User-Agent": settings.user_agent,
                                      "Accept-Language": "en-US,en;q=0.9"})


async def safe_get(url: str, *, accept: str = "text/html,application/xhtml+xml,*/*;q=0.8",
                   max_bytes: int | None = None, extra_headers: dict | None = None) -> FetchResult:
    max_bytes = max_bytes or settings.max_page_bytes
    redirects: list[str] = []
    seen = {url}
    async with _client() as client:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            ips = await assert_public_url(current)  # raises UnsafeURL
            parts = urlsplit(current)
            ip = ips[0]
            ip_host = f"[{ip}]" if ":" in ip else ip
            netloc = ip_host if parts.port is None else f"{ip_host}:{parts.port}"
            pinned = urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))
            host_header = parts.hostname if parts.port is None else f"{parts.hostname}:{parts.port}"
            headers = {"Host": host_header, "Accept": accept, **(extra_headers or {})}
            try:
                req = client.build_request("GET", pinned, headers=headers,
                                           extensions={"sni_hostname": parts.hostname})
                resp = await client.send(req, stream=True)
            except httpx.TimeoutException as e:
                raise FetchError(f"Timed out connecting to {parts.hostname}") from e
            except httpx.HTTPError as e:
                raise FetchError(f"Network error for {parts.hostname}: {type(e).__name__}: {e}") from e
            try:
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        raise FetchError("Redirect without a Location header")
                    nxt = urljoin(current, location)
                    if nxt in seen:
                        raise FetchError("Redirect loop detected")
                    seen.add(nxt)
                    redirects.append(nxt)
                    current = nxt
                    continue
                declared = int(resp.headers.get("content-length") or 0)
                if declared > max_bytes:
                    raise TooLarge(f"Response too large ({declared} bytes)")
                chunks, size = [], 0
                async for chunk in resp.aiter_bytes():
                    size += len(chunk)
                    if size > max_bytes:
                        raise TooLarge(f"Response exceeded {max_bytes} bytes")
                    chunks.append(chunk)
                return FetchResult(current, resp.status_code, resp.headers, b"".join(chunks), redirects)
            except httpx.HTTPError as e:
                raise FetchError(f"Error reading response: {e}") from e
            finally:
                await resp.aclose()
        raise FetchError("Too many redirects")
