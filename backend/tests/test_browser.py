"""Real Chromium tests (marked `browser`). Skipped automatically if Playwright's Chromium isn't installed."""

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app import netguard
from app.extract import BrowserPool, parse_html, process_screenshot, render
from tests.conftest import fixture_html

pytestmark = pytest.mark.browser


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.end_headers()
            return
        body = fixture_html("saas.html").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def local_site(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    original = netguard.resolve_public

    async def allow_only_test_server(host, port_):
        if host == "127.0.0.1" and port_ == port:
            return ["127.0.0.1"]
        return await original(host, port_)

    monkeypatch.setattr(netguard, "resolve_public", allow_only_test_server)
    monkeypatch.setattr(netguard, "ALLOWED_PORTS", netguard.ALLOWED_PORTS | {port})
    yield f"http://127.0.0.1:{port}"
    server.shutdown()


@pytest.fixture
async def pool():
    p = BrowserPool()
    try:
        await p.get()
    except Exception as e:  # pragma: no cover - environment without Chromium
        pytest.skip(f"Chromium unavailable: {e}")
    yield p
    await p.close()


async def test_render_through_egress_proxy(local_site, pool):
    r = await render(pool, local_site + "/")
    assert r.status == 200
    assert "Create beautiful presentations with AI" in r.text
    assert r.screenshot and r.screenshot[:2] == b"\xff\xd8"  # JPEG
    shot, thumb = process_screenshot(r.screenshot)
    assert thumb[:4] == b"RIFF"  # WebP
    ext = parse_html(r.html, r.final_url, rendered_text=r.text, method="browser")
    assert ext.meta["site_name"] == "SlideCraft"
    assert "Next.js" in ext.tech_stack


async def test_redirect_to_metadata_endpoint_is_blocked(local_site, pool):
    netguard.blocked_requests.clear()
    try:
        r = await render(pool, local_site + "/redirect")
        assert r.status == 403 and "meta-data" not in r.text  # the proxy refused the hop
    except Exception as e:  # Chromium may surface the refusal as a navigation error instead
        assert "ERR_" in str(e)
    assert any("169.254.169.254" in b for b in netguard.blocked_requests)
