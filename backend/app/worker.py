"""Background worker: `python -m app.worker`.

Claims jobs from the ingestion_jobs table with FOR UPDATE SKIP LOCKED (safe with many workers), runs up to
WORKER_CONCURRENCY jobs at once sharing one Chromium, recovers jobs orphaned by a crashed worker, and runs
periodic availability checks.
"""

import asyncio
import logging
import os
import signal
import socket
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text, update

from app.config import settings
from app.db import SessionLocal
from app.extract import BrowserPool
from app.models import ACTIVE_STATUSES, IngestionJob, Link, LinkStatus
from app.pipeline import check_availability, run_job

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("cairn.worker")

WORKER_ID = f"{socket.gethostname()}-{os.getpid()}"
STALE_AFTER = timedelta(minutes=15)


def claim_job() -> uuid.UUID | None:
    with SessionLocal() as db:
        job_id = db.execute(text("""
            UPDATE ingestion_jobs
               SET status = 'PROCESSING', locked_at = now(), locked_by = :worker, attempts = attempts + 1
             WHERE id = (SELECT id FROM ingestion_jobs
                          WHERE status = 'QUEUED' AND run_after <= now()
                          ORDER BY run_after, created_at
                          FOR UPDATE SKIP LOCKED
                          LIMIT 1)
         RETURNING id
        """), {"worker": WORKER_ID}).scalar()
        db.commit()
        return job_id


def recover_stale_jobs() -> int:
    """Requeue jobs whose worker died mid-run (lock older than STALE_AFTER)."""
    in_flight = [s for s in ACTIVE_STATUSES if s not in (LinkStatus.PENDING, LinkStatus.QUEUED)]
    with SessionLocal() as db:
        jobs = db.scalars(select(IngestionJob).where(
            IngestionJob.status.in_(in_flight),
            IngestionJob.locked_at < datetime.now(UTC) - STALE_AFTER)).all()
        for job in jobs:
            job.status = LinkStatus.QUEUED
            job.locked_by = None
            db.execute(update(Link).where(Link.id == job.link_id).values(status=LinkStatus.QUEUED))
        db.commit()
        return len(jobs)


def links_due_for_health_check(limit: int = 20) -> list[uuid.UUID]:
    cutoff = datetime.now(UTC) - timedelta(days=settings.health_check_days)
    with SessionLocal() as db:
        return list(db.scalars(select(Link.id).where(
            Link.deleted_at.is_(None),
            Link.status.in_([LinkStatus.COMPLETED, LinkStatus.NEEDS_REVIEW]),
            Link.last_checked_at < cutoff,
        ).order_by(Link.last_checked_at).limit(limit)))


async def job_loop(slot: int, pool: BrowserPool | None, stop: asyncio.Event) -> None:
    while not stop.is_set():
        job_id = await asyncio.to_thread(claim_job)
        if job_id is None:
            try:
                await asyncio.wait_for(stop.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                pass
            continue
        logger.info("slot %d: processing job %s", slot, job_id)
        await run_job(job_id, pool)


async def maintenance_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            if n := await asyncio.to_thread(recover_stale_jobs):
                logger.warning("requeued %d stale jobs", n)
            for link_id in await asyncio.to_thread(links_due_for_health_check):
                result = await check_availability(link_id)
                logger.info("health check %s: %s", link_id, result["availability"])
        except Exception:
            logger.exception("maintenance failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=600)
        except asyncio.TimeoutError:
            pass


async def main() -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows: Ctrl+C raises KeyboardInterrupt instead
            pass
    pool = BrowserPool() if settings.browser_enabled else None
    logger.info("worker %s started (concurrency=%d, browser=%s, ai=%s)", WORKER_ID,
                settings.worker_concurrency, settings.browser_enabled, settings.ai_provider)
    try:
        await asyncio.gather(maintenance_loop(stop),
                             *(job_loop(i, pool, stop) for i in range(settings.worker_concurrency)))
    finally:
        if pool:
            await pool.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
