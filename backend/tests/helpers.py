import io

from PIL import Image

from app.extract import Blocked, parse_html
from app.fetch import FetchError
from app.pipeline import run_job
from app.worker import claim_job
from tests.conftest import fixture_html

PAGES = {
    "slidecraft.example": "saas.html",
    "docs.fetchkit.example": "docs.html",
    "jane.example": "blog.html",
    "vidify.example": "spa_shell.html",
}


def png(w=1280, h=900) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (30, 60, 90)).save(buf, "PNG")
    return buf.getvalue()


async def fake_extract(url: str, pool):
    from urllib.parse import urlsplit

    host = urlsplit(url).hostname
    if host == "down.example":
        raise FetchError("Timed out connecting to down.example")
    if host == "blocked.example":
        raise Blocked("Protected by a Cloudflare challenge; automated access is not permitted")
    ext = parse_html(fixture_html(PAGES[host]), url, method="browser")
    ext.http_status = 200
    ext.screenshot = png()
    return ext


async def no_favicon(url):
    return None


def use_fake_network(monkeypatch):
    monkeypatch.setattr("app.pipeline.extract", fake_extract)
    monkeypatch.setattr("app.pipeline.fetch_favicon", no_favicon)


async def drain() -> int:
    n = 0
    while job_id := claim_job():
        await run_job(job_id, None)
        n += 1
    return n
