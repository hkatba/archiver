import pytest

from app.urls import InvalidURL, domain_of, extract_urls, normalize_url


@pytest.mark.parametrize("raw,expected", [
    ("https://Example.com", "https://example.com/"),
    ("example.com", "https://example.com/"),
    ("http://example.com:80/a/", "http://example.com/a"),
    ("https://example.com:443/docs/#section", "https://example.com/docs"),
    ("https://example.com:8443/x", "https://example.com:8443/x"),
    ("https://example.com/p?utm_source=x&b=2&a=1&fbclid=123", "https://example.com/p?a=1&b=2"),
    ("https://github.com/o/r?ref=main&utm_medium=social", "https://github.com/o/r?ref=main"),
    ("https://youtube.com/watch?v=abc&si=track", "https://youtube.com/watch?v=abc"),
    ("https://app.example.com/#/dashboard", "https://app.example.com/#/dashboard"),
    ("https://example.com/a%2Fb", "https://example.com/a%2Fb"),
    ("https://bücher.de/", "https://xn--bcher-kva.de/"),
    ("  https://example.com/path with space  ", "https://example.com/path%20with%20space"),
])
def test_normalize(raw, expected):
    assert normalize_url(raw) == expected


@pytest.mark.parametrize("raw", [
    "", "not a url", "ftp://example.com/file", "javascript:alert(1)", "https://user:pass@example.com/",
    "https://", "file:///etc/passwd", "https://intranet/", "x" * 5000,
])
def test_normalize_rejects(raw):
    with pytest.raises(InvalidURL):
        normalize_url(raw)


def test_dedup_key_equivalence():
    variants = ["https://example.com/tool?utm_campaign=a", "example.com/tool/", "HTTPS://EXAMPLE.COM/tool#pricing"]
    assert len({normalize_url(v) for v in variants}) == 1


def test_domain_of():
    assert domain_of("https://www.example.com/x") == "example.com"
    assert domain_of("https://docs.example.com/") == "docs.example.com"


def test_extract_urls_from_mixed_text():
    text = """Some tools:
    https://a.example.com/page, and (https://b.example.com/x).
    c.example.org
    name,url
    "Tool D","https://d.example.net/?q=1"
    <DT><A HREF="https://e.example.io/" ADD_DATE="1">E</A>
    not-a-domain
    """
    assert extract_urls(text) == [
        "https://a.example.com/page", "https://b.example.com/x", "c.example.org",
        "https://d.example.net/?q=1", "https://e.example.io/",
    ]
