"""URL parsing, normalization (the dedup key) and extraction from free text / CSV / bookmark exports."""

import re
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

# Query params that only track the visitor. Meaningful params (ref, id, q, v, ...) are kept.
TRACKING_PARAMS = {
    "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid",
    "li_fat_id", "mc_cid", "mc_eid", "igshid", "_hsenc", "_hsmi", "__hssc", "__hstc", "__hsfp",
    "mkt_tok", "oly_anon_id", "oly_enc_id", "vero_id", "_ga", "_gl", "ref_src", "ref_url", "s_cid",
    "si", "spm", "trk", "trkCampaign", "sc_cid", "rb_clickid", "srsltid",
}
TRACKING_PREFIXES = ("utm_", "mtm_", "pk_", "hsa_", "matomo_")

_URL_RE = re.compile(r"https?://[^\s\"'<>`]+", re.IGNORECASE)
_BARE_DOMAIN_RE = re.compile(r"^(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,24}(?:[/?#]\S*)?$",
                             re.IGNORECASE)
_TRAILING_JUNK = ".,;:!?)]}>'\""


class InvalidURL(ValueError):
    pass


def _is_tracking(key: str) -> bool:
    k = key.lower()
    return k in TRACKING_PARAMS or k.startswith(TRACKING_PREFIXES)


def normalize_url(raw: str) -> str:
    """Canonical form used as the per-user dedup key. Raises InvalidURL."""
    s = (raw or "").strip()
    if not s:
        raise InvalidURL("Empty URL")
    if len(s) > 4096:
        raise InvalidURL("URL is too long")
    if "://" not in s:
        if not _BARE_DOMAIN_RE.match(s):
            raise InvalidURL("Not a URL")
        s = "https://" + s
    try:
        parts = urlsplit(s)
        port = parts.port
    except ValueError as e:
        raise InvalidURL(f"Malformed URL: {e}") from None
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise InvalidURL("Only http and https URLs are supported")
    host = (parts.hostname or "").rstrip(".")
    if not host:
        raise InvalidURL("URL has no host")
    if parts.username or parts.password:
        raise InvalidURL("URLs with embedded credentials are not allowed")
    try:
        host = host.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise InvalidURL("Invalid international domain name") from None
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    elif "." not in host and host != "localhost":
        raise InvalidURL("Host must be a domain name")
    netloc = host if port is None or (scheme, port) in (("http", 80), ("https", 443)) else f"{host}:{port}"

    path = quote(parts.path, safe="/:@!$&'()*+,;=-._~%") or "/"  # keeps existing %-escapes (e.g. %2F)
    if len(path) > 1:
        path = path.rstrip("/") or "/"
    query = urlencode(sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
                             if not _is_tracking(k)))
    # Keep only SPA-style fragments (#/route, #!/route); plain anchors don't identify a different page
    fragment = parts.fragment if parts.fragment.startswith(("/", "!")) else ""
    return urlunsplit((scheme, netloc, path, query, fragment))


def domain_of(url: str) -> str:
    # shortcut: strips only "www."; use a public-suffix list if eTLD+1 grouping is ever needed
    host = urlsplit(url).hostname or ""
    return host[4:] if host.startswith("www.") else host


def extract_urls(text: str) -> list[str]:
    """Find URLs in pasted text, TXT, CSV or a browser bookmarks HTML export. Order-preserving."""
    found: list[str] = []
    for line in (text or "").splitlines():
        matches = [m.rstrip(_TRAILING_JUNK) for m in _URL_RE.findall(line)]
        if not matches:
            for cell in re.split(r"[,;\t ]+", line.strip()):
                cell = cell.strip().strip("\"'").rstrip(_TRAILING_JUNK)
                if cell and _BARE_DOMAIN_RE.match(cell):
                    matches.append(cell)
        found.extend(m for m in matches if m)
    return found
