from datetime import UTC, datetime

from sqlalchemy import select, update

from app.enrich import Enrichment, Feature, Pricing
from app.llm import Usage
from app.models import AIEnrichment, CodeSnippet, IngestionJob, Link, LinkStatus
from app.services import add_links
from app.storage import storage
from tests.helpers import drain, use_fake_network


def add(db, user_id, *urls):
    return add_links(db, user_id, list(urls)).created


async def test_full_pipeline_extractive(client, db, monkeypatch):
    use_fake_network(monkeypatch)
    [link] = add(db, client.user_id, "https://docs.fetchkit.example/quickstart")
    assert link.status == LinkStatus.QUEUED
    assert await drain() == 1
    db.expire_all()
    link = db.get(Link, link.id)
    assert link.status == LinkStatus.COMPLETED, link.status_detail
    assert link.name == "Quickstart"
    assert link.description == "Install FetchKit and send your first API request."
    assert link.embedding is not None and link.embedding_model == "hash-v1"
    assert link.search_primary and "FetchKit" in link.search_primary
    assert storage.path(link.screenshot_key).exists() and storage.path(link.thumbnail_key).exists()
    assert db.scalar(select(AIEnrichment).where(AIEnrichment.link_id == link.id)).provider == "extractive"
    snippets = db.scalars(select(CodeSnippet).where(CodeSnippet.link_id == link.id)).all()
    assert {s.language for s in snippets} == {"bash", "python"}


class FakeLLM:
    name, fast_model, smart_model = "fake", "fake-fast", "fake-smart"
    calls = 0

    async def structured(self, *, system, user, schema, smart=False):
        FakeLLM.calls += 1
        return Enrichment(
            name="SlideCraft", short_description="Generates slide decks from prompts.",
            tldr="SlideCraft builds presentations with AI. Use it for pitch decks.", content_type="tool",
            category="AI Tools", subcategory="AI Presentation Generator", tags=["presentations", "slides"],
            key_features=[Feature(name="Prompt to deck",
                                  evidence="Generate a full deck from one prompt or an uploaded document.")],
            pricing=Pricing(free_plan=True, starting_price="$12 per month",
                            evidence="Start free with up to 3 presentations per month."),
            confidence=0.9,
        ), Usage(800, 300)

    async def chat(self, *, system, messages):
        return "", Usage()


async def test_pipeline_with_llm_and_cache(client, db, monkeypatch):
    use_fake_network(monkeypatch)
    monkeypatch.setattr("app.pipeline.get_llm", lambda: FakeLLM())
    FakeLLM.calls = 0
    [link] = add(db, client.user_id, "https://slidecraft.example/")
    await drain()
    db.expire_all()
    link = db.get(Link, link.id)
    assert link.status == LinkStatus.COMPLETED
    assert link.name == "SlideCraft" and link.has_free_plan is True
    assert link.category.name == "AI Presentation Generator" and link.category.parent.name == "AI Tools"
    assert link.tags == ["presentations", "slides"]
    enr = db.scalar(select(AIEnrichment).where(AIEnrichment.link_id == link.id))
    assert (enr.tokens_in, enr.tokens_out) == (800, 300)

    # Same content saved by another user -> cached analysis, no second LLM call
    from tests.conftest import make_client

    other = make_client("bob@example.com")
    add(db, other.user_id, "https://slidecraft.example/")
    await drain()
    assert FakeLLM.calls == 1


async def test_retry_then_dead_letter(client, db, monkeypatch):
    use_fake_network(monkeypatch)
    [link] = add(db, client.user_id, "https://down.example/")
    for attempt in range(1, 4):
        await drain()
        db.expire_all()
        link = db.get(Link, link.id)
        job = db.scalar(select(IngestionJob).where(IngestionJob.link_id == link.id))
        assert job.attempts == attempt
        if attempt < 3:
            assert link.status == LinkStatus.QUEUED and "Retrying" in link.status_detail
            db.execute(update(IngestionJob).values(run_after=datetime.now(UTC)))  # skip the backoff wait
            db.commit()
    assert link.status == LinkStatus.FAILED
    assert "Timed out" in link.status_detail
    assert job.last_error.startswith("[extract]")


async def test_blocked_is_not_retried(client, db, monkeypatch):
    use_fake_network(monkeypatch)
    [link] = add(db, client.user_id, "https://blocked.example/")
    await drain()
    db.expire_all()
    link = db.get(Link, link.id)
    assert link.status == LinkStatus.BLOCKED
    assert "Cloudflare" in link.status_detail
    assert db.scalar(select(IngestionJob).where(IngestionJob.link_id == link.id)).attempts == 1


async def test_enrich_failure_resumes_without_reextracting(client, db, monkeypatch):
    use_fake_network(monkeypatch)
    calls = {"extract": 0}
    from tests import helpers

    async def counting_extract(url, pool):
        calls["extract"] += 1
        return await helpers.fake_extract(url, pool)

    class BrokenLLM(FakeLLM):
        async def structured(self, **kw):
            from app.llm import LLMError

            raise LLMError("provider down")

    monkeypatch.setattr("app.pipeline.extract", counting_extract)
    monkeypatch.setattr("app.pipeline.get_llm", lambda: BrokenLLM())
    [link] = add(db, client.user_id, "https://slidecraft.example/")
    await drain()
    db.expire_all()
    job = db.scalar(select(IngestionJob).where(IngestionJob.link_id == link.id))
    assert job.resume_from == "enrich" and db.get(Link, link.id).status == LinkStatus.QUEUED
    monkeypatch.setattr("app.pipeline.get_llm", lambda: FakeLLM())
    db.execute(update(IngestionJob).values(run_after=datetime.now(UTC)))
    db.commit()
    await drain()
    db.expire_all()
    assert db.get(Link, link.id).status == LinkStatus.COMPLETED
    assert calls["extract"] == 1


async def test_partial_content_needs_review(client, db, monkeypatch):
    use_fake_network(monkeypatch)
    from tests import helpers

    async def thin(url, pool):
        ext = await helpers.fake_extract(url, pool)
        ext.markdown, ext.meta["description"], ext.partial = "", None, True
        return ext

    monkeypatch.setattr("app.pipeline.extract", thin)
    [link] = add(db, client.user_id, "https://jane.example/post")
    await drain()
    db.expire_all()
    link = db.get(Link, link.id)
    assert link.status == LinkStatus.NEEDS_REVIEW
    assert "little readable content" in link.status_detail
