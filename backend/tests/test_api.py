from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import make_client
from tests.helpers import drain, use_fake_network


async def _ingest(client, monkeypatch, *urls):
    use_fake_network(monkeypatch)
    r = client.post("/api/links/bulk", json={"urls": list(urls)})
    assert r.status_code == 201, r.text
    await drain()
    return r.json()["created"]


def test_auth_flow():
    anon = TestClient(app)
    assert anon.get("/api/auth/me").status_code == 401
    c = make_client("carol@example.com")
    assert c.get("/api/auth/me").json()["email"] == "carol@example.com"
    assert TestClient(app).post("/api/auth/register", json={"email": "carol@example.com",
                                                            "password": "another password"}).status_code == 409
    bad = TestClient(app).post("/api/auth/login", json={"email": "carol@example.com", "password": "wrong-pass"})
    assert bad.status_code == 401
    assert c.post("/api/auth/logout").status_code == 204
    assert c.get("/api/auth/me").status_code == 401


def test_login_rate_limited():
    anon = TestClient(app)
    codes = [anon.post("/api/auth/login", json={"email": "x@example.com", "password": "password1"}).status_code
             for _ in range(12)]
    assert codes[-1] == 429


def test_api_tokens_bearer_auth(client):
    r = client.post("/api/tokens", json={"name": "Chrome extension"})
    token = r.json()["token"]
    bearer = TestClient(app)
    assert bearer.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    assert [t["name"] for t in client.get("/api/tokens").json()] == ["Chrome extension"]
    client.delete(f"/api/tokens/{r.json()['id']}")
    assert bearer.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_preview_and_dedup(client):
    text = "https://slidecraft.example/?utm_source=x\nslidecraft.example\nnot a url at all\njane.example/post"
    r = client.post("/api/links/preview", json={"text": text}).json()
    assert (r["total"], r["new"], r["duplicates"], r["invalid"]) == (3, 2, 1, 0)
    created = client.post("/api/links/bulk", json={"urls": ["https://slidecraft.example/", "ftp://x"]}).json()
    assert len(created["created"]) == 1 and len(created["invalid"]) == 1
    r = client.post("/api/links/preview", json={"text": "https://slidecraft.example/#features"}).json()
    assert r["items"][0]["duplicate_of"] == created["created"][0]["id"]
    dup = client.post("/api/links", json={"url": "slidecraft.example"})
    assert dup.status_code == 409 and dup.json()["link"]["id"] == created["created"][0]["id"]
    found = client.get("/api/links/lookup", params={"url": "https://slidecraft.example/?fbclid=1"}).json()
    assert found["id"] == created["created"][0]["id"]


async def test_user_isolation(client, monkeypatch):
    [link] = await _ingest(client, monkeypatch, "https://slidecraft.example/")
    mallory = make_client("mallory@example.com")
    assert mallory.get(f"/api/links/{link['id']}").status_code == 404
    assert mallory.get(f"/api/links/{link['id']}/screenshot").status_code == 404
    assert mallory.patch(f"/api/links/{link['id']}", json={"name": "pwned"}).status_code == 404
    assert mallory.get("/api/links").json()["total"] == 0
    assert mallory.post("/api/search", json={"query": "presentation"}).json()["results"] == []


async def test_detail_overrides_and_files(client, monkeypatch):
    [link] = await _ingest(client, monkeypatch, "https://slidecraft.example/")
    lid = link["id"]
    d = client.get(f"/api/links/{lid}").json()
    assert d["status"] == "COMPLETED" and d["name"] == "SlideCraft"
    assert d["markdown"] and d["extraction"]["method"] == "browser" and d["logs"]
    assert client.get(d["screenshot"]).headers["content-type"] == "image/jpeg"
    assert client.get(d["thumbnail"]).headers["content-type"] == "image/webp"

    r = client.patch(f"/api/links/{lid}", json={"name": "My Deck Tool", "tags": ["Slides", "work"],
                                                "category": "Productivity", "notes": "use for pitch decks",
                                                "is_favorite": True}).json()
    assert r["name"] == "My Deck Tool" and r["tags"] == ["slides", "work"] and r["category"] == "Productivity"
    assert r["is_favorite"] is True
    # Regenerating AI analysis must not clobber user edits
    client.post(f"/api/links/{lid}/regenerate")
    await drain()
    d = client.get(f"/api/links/{lid}").json()
    assert d["name"] == "My Deck Tool" and d["tags"] == ["slides", "work"] and d["notes"] == "use for pitch decks"
    # Clearing an override reverts to the AI/extracted value
    assert client.patch(f"/api/links/{lid}", json={"name": None}).json()["name"] == "SlideCraft"
    md = client.get(f"/api/links/{lid}/markdown")
    assert md.headers["content-type"].startswith("text/markdown") and "use for pitch decks" in md.text


async def test_list_filters_trash_and_restore(client, monkeypatch):
    links = await _ingest(client, monkeypatch, "https://slidecraft.example/", "https://jane.example/post",
                          "https://docs.fetchkit.example/quickstart")
    assert client.get("/api/links").json()["total"] == 3
    assert client.get("/api/links", params={"domain": "jane.example"}).json()["total"] == 1
    assert client.get("/api/links", params={"q": "fetchkit"}).json()["total"] == 1
    assert client.get("/api/links", params={"status": "COMPLETED"}).json()["total"] == 3
    lid = links[0]["id"]
    assert client.delete(f"/api/links/{lid}").status_code == 204
    assert client.get("/api/links").json()["total"] == 2
    assert client.get("/api/links", params={"deleted": True}).json()["total"] == 1
    assert client.post(f"/api/links/{lid}/restore").status_code == 200
    assert client.get("/api/links").json()["total"] == 3


async def test_search_hybrid_keyword_and_reasons(client, monkeypatch):
    await _ingest(client, monkeypatch, "https://slidecraft.example/", "https://jane.example/post",
                  "https://docs.fetchkit.example/quickstart")
    r = client.post("/api/search", json={"query": "tool to make presentation slides"}).json()
    assert r["results"][0]["link"]["domain"] == "slidecraft.example"
    assert any(reason.startswith("Keywords") for reason in r["results"][0]["reasons"])
    r = client.post("/api/search", json={"query": "debug API requests", "mode": "keyword"}).json()
    assert [x["link"]["domain"] for x in r["results"]] == ["docs.fetchkit.example"]
    r = client.post("/api/search", json={"query": "", "filters": {"domain": "jane.example"}}).json()
    assert len(r["results"]) == 1


async def test_collections_manual_and_smart(client, monkeypatch):
    links = await _ingest(client, monkeypatch, "https://slidecraft.example/", "https://jane.example/post")
    manual = client.post("/api/collections", json={"name": "Favorites to try"}).json()
    client.post(f"/api/collections/{manual['id']}/links", json={"link_ids": [links[0]["id"]]})
    assert client.get(f"/api/collections/{manual['id']}/links").json()["total"] == 1
    smart = client.post("/api/collections", json={"name": "Blog posts",
                                                  "rules": {"domain": "jane.example"}}).json()
    assert smart["is_smart"] and smart["link_count"] == 1
    assert client.post(f"/api/collections/{smart['id']}/links",
                       json={"link_ids": [links[0]["id"]]}).status_code == 400
    # Saving straight into a collection
    r = client.post("/api/links", json={"url": "https://docs.fetchkit.example/quickstart",
                                        "collection_id": manual["id"]})
    assert r.status_code == 201
    assert client.get(f"/api/collections/{manual['id']}").json()["link_count"] == 2
    detail = client.get(f"/api/links/{links[0]['id']}").json()
    assert detail["collections"][0]["name"] == "Favorites to try"


async def test_merge_keeps_user_data(client, monkeypatch):
    a, b = await _ingest(client, monkeypatch, "https://slidecraft.example/", "https://slidecraft.example/home")
    col = client.post("/api/collections", json={"name": "Decks"}).json()
    client.post(f"/api/collections/{col['id']}/links", json={"link_ids": [b["id"]]})
    client.patch(f"/api/links/{b['id']}", json={"notes": "note on b", "is_favorite": True})
    merged = client.post(f"/api/links/{b['id']}/merge", json={"into_id": a["id"]}).json()
    assert merged["id"] == a["id"] and merged["is_favorite"] is True
    d = client.get(f"/api/links/{a['id']}").json()
    assert "note on b" in d["notes"] and d["collections"][0]["name"] == "Decks"
    assert client.get("/api/links").json()["total"] == 1


async def test_stats_facets_snippets(client, monkeypatch):
    await _ingest(client, monkeypatch, "https://slidecraft.example/", "https://docs.fetchkit.example/quickstart")
    s = client.get("/api/stats").json()
    assert s["total"] == 2 and s["completed"] == 2 and s["in_progress"] == 0
    assert s["ai"]["provider"] == "extractive" and len(s["recent"]) == 2
    assert any(t["name"] == "pitch deck" for t in s["top_tags"])
    assert client.get("/api/tags").json()
    snippets = client.get("/api/snippets", params={"language": "python"}).json()
    assert len(snippets) == 1 and snippets[0]["link_name"] == "Quickstart"


def test_assistant_requires_provider(client):
    r = client.post("/api/assistant", json={"messages": [{"role": "user", "content": "best AI tools?"}]})
    assert r.status_code == 400 and "AI_PROVIDER" in r.json()["detail"]


async def test_assistant_answers_from_library(client, monkeypatch):
    await _ingest(client, monkeypatch, "https://slidecraft.example/", "https://jane.example/post")
    from app.llm import Usage

    seen = {}

    class ChatLLM:
        name, fast_model, smart_model = "fake", "f", "s"

        async def chat(self, *, system, messages):
            seen["system"], seen["prompt"] = system, messages[-1]["content"]
            return "Use SlideCraft [1] for decks.", Usage()

    monkeypatch.setattr("app.api.discover.get_llm", lambda: ChatLLM())
    r = client.post("/api/assistant", json={"messages": [{"role": "user", "content": "make presentation slides"}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"].startswith("Use SlideCraft") and body["sources"][0]["domain"] == "slidecraft.example"
    assert "Never claim the library contains" in seen["system"] and "[1] SlideCraft" in seen["prompt"]


async def test_export_and_import_roundtrip(client, monkeypatch):
    await _ingest(client, monkeypatch, "https://slidecraft.example/", "https://jane.example/post")
    client.patch(f"/api/links/{client.get('/api/links').json()['items'][0]['id']}", json={"notes": "keep me"})
    col = client.post("/api/collections", json={"name": "Saved"}).json()
    client.post(f"/api/collections/{col['id']}/links",
                json={"link_ids": [i["id"] for i in client.get("/api/links").json()["items"]]})
    backup = client.get("/api/export").json()
    assert backup["format"] == "cairn-export" and len(backup["links"]) == 2
    zipped = client.get("/api/export", params={"format": "markdown"})
    assert zipped.headers["content-type"] == "application/zip" and len(zipped.content) > 200

    other = make_client("restore@example.com")
    r = other.post("/api/import", json=backup).json()
    assert r == {"restored": 2, "skipped": 0}
    await drain()  # re-embeds locally
    items = other.get("/api/links").json()["items"]
    assert {i["status"] for i in items} == {"COMPLETED"}
    assert any(other.get(f"/api/links/{i['id']}").json()["notes"] == "keep me" for i in items)
    assert other.get("/api/collections").json()[0]["link_count"] == 2
    assert other.post("/api/import", json=backup).json() == {"restored": 0, "skipped": 2}
