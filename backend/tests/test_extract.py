from app.extract import detect_block, detect_tech, github_repo, markdown_code_snippets, parse_html
from tests.conftest import fixture_html


def test_saas_landing_page():
    ext = parse_html(fixture_html("saas.html"), "https://slidecraft.example/home")
    assert ext.title == "SlideCraft — AI Presentation Maker"
    assert ext.meta["site_name"] == "SlideCraft"
    assert ext.meta["description"].startswith("SlideCraft turns a short prompt")
    assert ext.meta["image"] == "https://slidecraft.example/og.png"
    assert ext.meta["keywords"] == ["ai presentations", "slide generator", "pitch deck"]
    assert ext.meta["jsonld"][0]["name"] == "SlideCraft"
    assert ext.canonical_url == "https://slidecraft.example/"
    assert ext.favicon_url == "https://slidecraft.example/apple-touch-icon.png"  # largest raster icon
    assert "slide decks from a single prompt" in ext.markdown
    assert "$12 per month" in ext.markdown
    assert "Next.js" in ext.tech_stack and "React" in ext.tech_stack
    assert "Create beautiful presentations with AI" in ext.headings


def test_documentation_page_code_snippets():
    ext = parse_html(fixture_html("docs.html"), "https://docs.fetchkit.example/quickstart")
    langs = [s["language"] for s in ext.code_snippets]
    assert langs == ["bash", "python"]
    assert ext.code_snippets[1]["context"] == "Send a request"
    assert "fetchkit.Client" in ext.code_snippets[1]["code"]
    assert all(s["code"] != "short" for s in ext.code_snippets)
    assert "Docusaurus" in ext.tech_stack


def test_blog_article():
    ext = parse_html(fixture_html("blog.html"), "https://jane.example/local-first")
    assert ext.meta["type"] == "article"
    assert "Local-first apps store your data" in ext.markdown
    assert "Subscribe to my newsletter" not in ext.markdown


def test_js_shell_uses_rendered_text():
    html = fixture_html("spa_shell.html")
    rendered = "Vidify\nTurn any script into a narrated video in minutes.\nPick a voice, choose a style, export in 4K."
    ext = parse_html(html, "https://vidify.example/", rendered_text=rendered, method="browser")
    assert "narrated video" in ext.markdown
    assert ext.meta["description"] == "Turn text into videos."


def test_detect_block():
    html = fixture_html("cloudflare.html")
    assert "Cloudflare" in detect_block(403, "Just a moment...", html, {})
    assert detect_block(200, "Ok", html, {"cf-mitigated": "challenge"})
    assert "CAPTCHA" in detect_block(200, "Verify", '<div class="g-recaptcha"></div>', {})
    assert "403" in detect_block(403, "Forbidden", "<html></html>", {})
    assert detect_block(200, "Home", fixture_html("saas.html"), {}) is None


def test_detect_tech_headers():
    assert detect_tech("", {"x-vercel-id": "abc", "server": "nginx/1.2"}) == ["Vercel", "nginx"]


def test_github_repo_parsing():
    assert github_repo("https://github.com/psf/requests") == ("psf", "requests")
    assert github_repo("https://github.com/psf/requests.git") == ("psf", "requests")
    assert github_repo("https://github.com/psf/requests/tree/main/docs") == ("psf", "requests")
    assert github_repo("https://github.com/features/actions") is None
    assert github_repo("https://github.com/psf") is None
    assert github_repo("https://gitlab.com/a/b") is None


def test_markdown_code_snippets():
    md = "# Usage\n\n```js\nconst x = require('x');\nx.run({ fast: true });\n```\n\n```\nhi\n```\n"
    snips = markdown_code_snippets(md)
    assert len(snips) == 1 and snips[0]["language"] == "js" and snips[0]["context"] == "Usage"
