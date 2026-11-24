"""Ingestion pipeline: extract -> enrich -> index, with stage resume, retries and structured logs.

DB work is synchronous (SQLAlchemy) and runs in threads; network/browser/LLM work is async.
"""

import asyncio
import logging
import time
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, or_, select

from app.config import settings
from app.db import SessionLocal
from app.embeddings import get_embedder
from app.enrich import PROMPT_VERSION, build_prompt, extractive_enrichment, input_hash, llm_enrichment
from app.extract import Blocked, BrowserPool, Extraction, PermanentError, extract, fetch_favicon, process_screenshot
from app.fetch import FetchError, safe_get
from app.llm import LLMError, get_llm
from app.models import (
    AIEnrichment,
    AvailabilityCheck,
    CodeSnippet,
    ExtractedContent,
    IngestionJob,
    Link,
    LinkStatus,
)
from app.netguard import UnsafeURL
from app.services import apply_effective, embedding_text, latest_enrichment, latest_extraction, log
from app.storage import storage
from app.urls import InvalidURL, domain_of, normalize_url

logger = logging.getLogger("cairn.pipeline")

STAGES = ["extract", "enrich", "index"]
STAGE_STATUS = {"extract": LinkStatus.PROCESSING, "enrich": LinkStatus.ENRICHING, "index": LinkStatus.INDEXING}


class StageFailure(Exception):
    def __init__(self, stage: str, error: Exception):
        super().__init__(str(error))
        self.stage, self.error = stage, error


# ---------------------------------------------------------------- per-domain politeness

_domain_next: dict[str, float] = {}
_domain_lock = asyncio.Lock()


async def wait_for_domain(domain: str) -> None:
    async with _domain_lock:
        now = time.monotonic()
        slot = max(now, _domain_next.get(domain, 0.0))
        _domain_next[domain] = slot + settings.domain_delay_seconds
    if slot > now:
        await asyncio.sleep(slot - now)


# ---------------------------------------------------------------- sync DB helpers


def _set_stage(job_id: uuid.UUID, stage: str) -> None:
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        link = db.get(Link, job.link_id)
        job.status = link.status = STAGE_STATUS[stage]
        job.locked_at = datetime.now(UTC)  # heartbeat: stale-job recovery only requeues silent jobs
        log(db, link.id, stage, f"Started {stage}", job_id=job_id)
        db.commit()


def _canonical_duplicate(db, link: Link) -> uuid.UUID | None:
    candidates = {u for u in (link.canonical_url, link.final_url) if u}
    keys = set()
    for u in candidates:
        try:
            keys.add(normalize_url(u))
        except InvalidURL:
            pass
    keys.discard(link.normalized_url)
    if not keys:
        return None
    return db.scalar(select(Link.id).where(
        Link.user_id == link.user_id, Link.id != link.id, Link.deleted_at.is_(None),
        Link.created_at < link.created_at,
        or_(Link.normalized_url.in_(keys), Link.canonical_url.in_(keys)),
    ).limit(1))


def _save_extraction(job_id: uuid.UUID, link_id: uuid.UUID, ext: Extraction, favicon: bytes | None) -> None:
    images = process_screenshot(ext.screenshot) if ext.screenshot else None
    with SessionLocal() as db:
        link = db.get(Link, link_id)
        prefix = f"{link.user_id}/{link.id}"
        if images:
            link.screenshot_key = storage.put(f"{prefix}/screenshot.jpg", images[0])
            link.thumbnail_key = storage.put(f"{prefix}/thumbnail.webp", images[1])
        if favicon:
            link.favicon_key = storage.put(f"{prefix}/favicon.png", favicon)
        meta = dict(ext.meta, redirects=ext.redirects, notes=ext.notes)
        db.add(ExtractedContent(
            link_id=link.id, method=ext.method, partial=ext.partial, http_status=ext.http_status,
            final_url=ext.final_url, canonical_url=ext.canonical_url, title=ext.title, meta=meta,
            markdown=ext.markdown, text_length=ext.text_length, content_hash=ext.content_hash,
            headings=ext.headings, tech_stack=ext.tech_stack, github=ext.github,
        ))
        db.execute(delete(CodeSnippet).where(CodeSnippet.link_id == link.id))
        for s in ext.code_snippets:
            db.add(CodeSnippet(link_id=link.id, **s))
        link.final_url = ext.final_url
        link.canonical_url = ext.canonical_url
        link.title = ext.title
        link.http_status = ext.http_status
        link.image_url = ext.meta.get("image")
        link.favicon_url = ext.favicon_url
        link.availability = "redirected" if domain_of(ext.final_url) != link.domain else "up"
        link.last_checked_at = datetime.now(UTC)
        dup = _canonical_duplicate(db, link)
        link.duplicate_of_id = dup
        log(db, link.id, "extract",
            f"Extracted {ext.text_length} characters via {ext.method}"
            + (f", {len(ext.code_snippets)} code snippets" if ext.code_snippets else "")
            + (" (screenshot captured)" if images else " (no screenshot)"),
            job_id=job_id, data={"redirects": ext.redirects, "notes": ext.notes, "tech": ext.tech_stack})
        if dup:
            log(db, link.id, "extract", "Same canonical page as another saved link", level="warning",
                job_id=job_id, data={"duplicate_of": str(dup)})
        db.commit()


def _enrichment_inputs(link_id: uuid.UUID) -> dict:
    with SessionLocal() as db:
        link = db.get(Link, link_id)
        ext = latest_extraction(db, link_id)
        if ext is None:
            raise PermanentError("No extracted content to analyze")
        return {
            "url": link.normalized_url, "final_url": ext.final_url, "title": ext.title, "meta": ext.meta,
            "headings": ext.headings, "tech_stack": ext.tech_stack, "github": ext.github,
            "markdown": ext.markdown, "domain": link.domain,
        }


def _cached_enrichment(h: str) -> AIEnrichment | None:
    with SessionLocal() as db:
        return db.scalar(select(AIEnrichment).where(AIEnrichment.input_hash == h)
                         .order_by(AIEnrichment.created_at.desc()).limit(1))


def _save_enrichment(job_id, link_id, data, provider, model, h, usage_in, usage_out, note) -> None:
    with SessionLocal() as db:
        link = db.get(Link, link_id)
        db.add(AIEnrichment(link_id=link_id, provider=provider, model=model, prompt_version=PROMPT_VERSION,
                            input_hash=h, data=data, confidence=data.get("confidence"),
                            tokens_in=usage_in, tokens_out=usage_out))
        db.flush()
        apply_effective(db, link)
        log(db, link_id, "enrich", note, job_id=job_id,
            data={"provider": provider, "model": model, "tokens_in": usage_in, "tokens_out": usage_out,
                  "unknowns": data.get("unknowns")})
        db.commit()


def _index(job_id: uuid.UUID, link_id: uuid.UUID) -> None:
    embedder = get_embedder()
    with SessionLocal() as db:
        link = db.get(Link, link_id)
        enr = latest_enrichment(db, link_id)
        apply_effective(db, link)
        text = embedding_text(link, enr.data if enr else {})
        link.embedding = embedder.documents([text])[0]
        link.embedding_model = embedder.name
        log(db, link_id, "index", f"Indexed for search ({embedder.name})", job_id=job_id)
        db.commit()


def _finish(job_id: uuid.UUID) -> None:
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        link = db.get(Link, job.link_id)
        ext = latest_extraction(db, link.id)
        problems = []
        if ext and ext.partial:
            problems.append("Very little readable content was extracted")
        status = LinkStatus.NEEDS_REVIEW if problems else LinkStatus.COMPLETED
        job.status = link.status = status
        link.status_detail = "; ".join(problems) or None
        job.finished_at = link.last_processed_at = datetime.now(UTC)
        job.last_error = None
        log(db, link.id, "done", f"Finished: {status.value}" + (f" ({link.status_detail})" if problems else ""),
            job_id=job_id)
        db.commit()


def _fail(job_id: uuid.UUID, failure: StageFailure) -> None:
    err, stage = failure.error, failure.stage
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        link = db.get(Link, job.link_id)
        message = str(err) or type(err).__name__
        retryable = not isinstance(err, (Blocked, PermanentError, UnsafeURL))
        job.last_error = f"[{stage}] {message}"
        job.resume_from = stage
        if retryable and job.attempts < job.max_attempts:
            delay = 30 * 4 ** (job.attempts - 1)  # 30s, 2m, 8m
            job.status = link.status = LinkStatus.QUEUED
            job.run_after = datetime.now(UTC) + timedelta(seconds=delay)
            link.status_detail = f"Attempt {job.attempts} failed at {stage}: {message}. Retrying in {delay}s."
            log(db, link.id, stage, f"Attempt {job.attempts} failed, retry scheduled: {message}",
                level="warning", job_id=job_id)
        else:
            cached = latest_extraction(db, link.id) if stage == "extract" else None
            if cached is not None and not isinstance(err, PermanentError):
                # Link-rot protection: keep serving the archived copy
                job.status = link.status = LinkStatus.NEEDS_REVIEW
                link.availability = "down"
                link.status_detail = (f"Live fetch failed ({message}); showing the archived copy from "
                                      f"{cached.created_at:%Y-%m-%d}")
            else:
                job.status = link.status = (LinkStatus.BLOCKED if isinstance(err, (Blocked, UnsafeURL))
                                            else LinkStatus.FAILED)
                link.status_detail = message
            job.finished_at = datetime.now(UTC)
            log(db, link.id, stage, f"{link.status.value}: {message}", level="error", job_id=job_id,
                data={"attempts": job.attempts, "error_type": type(err).__name__})
        db.commit()


# ---------------------------------------------------------------- stages


async def run_job(job_id: uuid.UUID, pool: BrowserPool | None) -> None:
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        link = db.get(Link, job.link_id)
        start = STAGES.index(job.resume_from) if job.resume_from in STAGES else 0
        link_id, url, domain = link.id, link.normalized_url, link.domain
        if link.deleted_at:
            job.status, job.finished_at = LinkStatus.FAILED, datetime.now(UTC)
            job.last_error = "Link was deleted"
            db.commit()
            return
    stage = STAGES[start]
    try:
        for stage in STAGES[start:]:
            await asyncio.to_thread(_set_stage, job_id, stage)
            if stage == "extract":
                await wait_for_domain(domain)
                ext = await extract(url, pool)
                favicon = await fetch_favicon(ext.favicon_url) if ext.favicon_url else None
                await asyncio.to_thread(_save_extraction, job_id, link_id, ext, favicon)
            elif stage == "enrich":
                await enrich_link(job_id, link_id)
            else:
                await asyncio.to_thread(_index, job_id, link_id)
        await asyncio.to_thread(_finish, job_id)
    except Exception as e:  # noqa: BLE001 - every failure is recorded on the job
        if not isinstance(e, (Blocked, PermanentError, UnsafeURL, FetchError, LLMError)):
            logger.exception("job %s failed at %s", job_id, stage)
        await asyncio.to_thread(_fail, job_id, StageFailure(stage, e))


async def enrich_link(job_id: uuid.UUID, link_id: uuid.UUID) -> None:
    inp = await asyncio.to_thread(_enrichment_inputs, link_id)
    llm = get_llm()
    if llm is None:
        data = await asyncio.to_thread(
            extractive_enrichment, title=inp["title"], meta=inp["meta"], markdown=inp["markdown"],
            github=inp["github"], domain=inp["domain"])
        await asyncio.to_thread(_save_enrichment, job_id, link_id, data, "extractive", "none", "", 0, 0,
                                "Built profile from page metadata (no AI provider configured)")
        return
    prompt = build_prompt(**{k: inp[k] for k in ("url", "final_url", "title", "meta", "headings", "tech_stack",
                                                  "github", "markdown")})
    h = input_hash(llm.name, llm.fast_model, prompt)
    cached = await asyncio.to_thread(_cached_enrichment, h)
    if cached:
        await asyncio.to_thread(_save_enrichment, job_id, link_id, cached.data, cached.provider, cached.model, h,
                                0, 0, "Reused cached AI analysis (identical content)")
        return
    source_text = "\n".join(str(x) for x in (inp["title"], inp["meta"], inp["github"], inp["markdown"]) if x)
    data, usage = await llm_enrichment(llm, prompt, source_text)
    await asyncio.to_thread(_save_enrichment, job_id, link_id, data, llm.name, llm.fast_model, h,
                            usage.input_tokens, usage.output_tokens,
                            f"AI analysis by {llm.name}/{llm.fast_model} "
                            f"(confidence {data['confidence']:.2f})")


# ---------------------------------------------------------------- health checks


async def check_availability(link_id: uuid.UUID) -> dict:
    """Lightweight HTTP check (no browser). Records history and updates link.availability."""
    def load():
        with SessionLocal() as db:
            link = db.get(Link, link_id)
            return link.normalized_url, link.domain

    url, domain = await asyncio.to_thread(load)
    ok, status, final_url, error = False, None, None, None
    try:
        res = await safe_get(url, max_bytes=2_000_000)
        status, final_url = res.status, res.url
        ok = status < 400 or status in (401, 403, 429)  # reachable, just restricted
    except (FetchError, UnsafeURL) as e:
        error = str(e)[:500]

    def save():
        with SessionLocal() as db:
            link = db.get(Link, link_id)
            db.add(AvailabilityCheck(link_id=link_id, ok=ok, http_status=status, final_url=final_url, error=error))
            link.availability = ("down" if not ok else
                                 "redirected" if final_url and domain_of(final_url) != domain else "up")
            link.last_checked_at = datetime.now(UTC)
            db.commit()
            return {"availability": link.availability, "http_status": status, "final_url": final_url,
                    "error": error, "checked_at": link.last_checked_at.isoformat()}

    return await asyncio.to_thread(save)
