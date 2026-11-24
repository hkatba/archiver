"""Link lifecycle helpers shared by the API and the worker."""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    ACTIVE_STATUSES,
    AIEnrichment,
    Category,
    Collection,
    CollectionLink,
    ExtractedContent,
    IngestionJob,
    Link,
    LinkStatus,
    LinkTag,
    ProcessingLog,
    Tag,
)
from app.config import settings
from app.urls import InvalidURL, domain_of, normalize_url

MAX_TAG_LEN = 40


# ---------------------------------------------------------------- ingestion


@dataclass
class PreviewItem:
    input: str
    normalized_url: str | None = None
    valid: bool = False
    error: str | None = None
    duplicate_of: uuid.UUID | None = None
    duplicate_in_batch: bool = False


@dataclass
class AddResult:
    created: list[Link] = field(default_factory=list)
    duplicates: list[PreviewItem] = field(default_factory=list)
    invalid: list[PreviewItem] = field(default_factory=list)


def preview_urls(db: Session, user_id: uuid.UUID, raw_urls: list[str]) -> list[PreviewItem]:
    items: list[PreviewItem] = []
    for raw in raw_urls:
        item = PreviewItem(input=raw)
        try:
            item.normalized_url = normalize_url(raw)
            item.valid = True
        except InvalidURL as e:
            item.error = str(e)
        items.append(item)
    normalized = [i.normalized_url for i in items if i.valid]
    existing = dict(db.execute(
        select(Link.normalized_url, Link.id).where(
            Link.user_id == user_id, Link.deleted_at.is_(None), Link.normalized_url.in_(normalized))
    ).all()) if normalized else {}
    seen: set[str] = set()
    for i in items:
        if not i.valid:
            continue
        i.duplicate_of = existing.get(i.normalized_url)
        i.duplicate_in_batch = i.normalized_url in seen
        seen.add(i.normalized_url)
    return items


def add_links(db: Session, user_id: uuid.UUID, raw_urls: list[str],
              collection_id: uuid.UUID | None = None, notes: str | None = None) -> AddResult:
    if collection_id is not None:
        get_collection(db, user_id, collection_id, manual_only=True)
    result = AddResult()
    for item in preview_urls(db, user_id, raw_urls):
        if not item.valid:
            result.invalid.append(item)
        elif item.duplicate_of or item.duplicate_in_batch:
            result.duplicates.append(item)
        else:
            link = Link(user_id=user_id, url=item.input.strip(), normalized_url=item.normalized_url,
                        domain=domain_of(item.normalized_url), status=LinkStatus.QUEUED, notes=notes,
                        name=domain_of(item.normalized_url))
            db.add(link)
            db.flush()
            db.add(IngestionJob(user_id=user_id, link_id=link.id, max_attempts=settings.max_attempts))
            if collection_id:
                db.add(CollectionLink(collection_id=collection_id, link_id=link.id))
            result.created.append(link)
    # Add duplicates to the requested collection too, so "save to collection" always works
    if collection_id:
        for d in result.duplicates:
            if d.duplicate_of and not db.get(CollectionLink, (collection_id, d.duplicate_of)):
                db.add(CollectionLink(collection_id=collection_id, link_id=d.duplicate_of))
    db.commit()
    return result


def enqueue(db: Session, link: Link, *, resume_from: str = "extract", kind: str = "ingest") -> IngestionJob | None:
    """Queue processing for a link unless a job is already active. Caller commits."""
    active = db.scalar(select(IngestionJob).where(
        IngestionJob.link_id == link.id, IngestionJob.status.in_(ACTIVE_STATUSES)))
    if active:
        return None
    job = IngestionJob(user_id=link.user_id, link_id=link.id, kind=kind, resume_from=resume_from,
                       max_attempts=settings.max_attempts)
    db.add(job)
    link.status = LinkStatus.QUEUED
    link.status_detail = None
    return job


def log(db: Session, link_id: uuid.UUID, stage: str, message: str, *, level: str = "info",
        job_id: uuid.UUID | None = None, data: dict | None = None) -> None:
    db.add(ProcessingLog(link_id=link_id, job_id=job_id, stage=stage, level=level, message=message, data=data))


# ---------------------------------------------------------------- lookups


def get_link(db: Session, user_id: uuid.UUID, link_id: uuid.UUID, *, include_deleted: bool = False) -> Link:
    from fastapi import HTTPException

    link = db.get(Link, link_id)
    if not link or link.user_id != user_id or (link.deleted_at and not include_deleted):
        raise HTTPException(404, "Link not found")
    return link


def get_collection(db: Session, user_id: uuid.UUID, collection_id: uuid.UUID,
                   manual_only: bool = False) -> Collection:
    from fastapi import HTTPException

    c = db.get(Collection, collection_id)
    if not c or c.user_id != user_id:
        raise HTTPException(404, "Collection not found")
    if manual_only and c.rules is not None:
        raise HTTPException(400, "Links can't be added to a smart collection manually")
    return c


def latest_extraction(db: Session, link_id: uuid.UUID) -> ExtractedContent | None:
    return db.scalar(select(ExtractedContent).where(ExtractedContent.link_id == link_id)
                     .order_by(ExtractedContent.created_at.desc()).limit(1))


def latest_enrichment(db: Session, link_id: uuid.UUID) -> AIEnrichment | None:
    return db.scalar(select(AIEnrichment).where(AIEnrichment.link_id == link_id)
                     .order_by(AIEnrichment.created_at.desc()).limit(1))


# ---------------------------------------------------------------- categories & tags


def ensure_category(db: Session, user_id: uuid.UUID, parent: str | None, child: str | None) -> Category | None:
    parent = (parent or "").strip()[:120]
    child = (child or "").strip()[:120]
    if not parent:
        return None
    top = db.scalar(select(Category).where(Category.user_id == user_id, Category.parent_id.is_(None),
                                           Category.name == parent))
    if not top:
        top = Category(user_id=user_id, name=parent)
        db.add(top)
        db.flush()
    if not child or child.lower() == parent.lower():
        return top
    sub = db.scalar(select(Category).where(Category.user_id == user_id, Category.parent_id == top.id,
                                           Category.name == child))
    if not sub:
        sub = Category(user_id=user_id, name=child, parent_id=top.id)
        db.add(sub)
        db.flush()
    return sub


def category_names(link: Link) -> tuple[str | None, str | None]:
    c = link.category
    if c is None:
        return None, None
    return (c.parent.name, c.name) if c.parent else (c.name, None)


def clean_tag(name: str) -> str:
    return " ".join(name.strip().lower().lstrip("#").split())[:MAX_TAG_LEN]


def set_tags(db: Session, link: Link, names: list[str], source: str) -> None:
    """Replace this link's tags of the given source ("ai" or "user")."""
    wanted = list(dict.fromkeys(t for t in (clean_tag(n) for n in names) if t))
    db.execute(delete(LinkTag).where(LinkTag.link_id == link.id, LinkTag.source == source))
    db.flush()
    existing_ids = {lt.tag_id for lt in db.scalars(select(LinkTag).where(LinkTag.link_id == link.id))}
    for name in wanted:
        tag = db.scalar(select(Tag).where(Tag.user_id == link.user_id, Tag.name == name))
        if not tag:
            tag = Tag(user_id=link.user_id, name=name)
            db.add(tag)
            db.flush()
        if tag.id not in existing_ids:
            db.add(LinkTag(link_id=link.id, tag_id=tag.id, source=source))
            existing_ids.add(tag.id)
    db.flush()
    db.expire(link, ["link_tags"])


# ---------------------------------------------------------------- effective values


def _first(*values):
    for v in values:
        if v not in (None, "", []):
            return v
    return None


def apply_effective(db: Session, link: Link) -> None:
    """Recompute display columns + search document. Precedence: user overrides > AI > extracted metadata."""
    ov = link.overrides or {}
    enr = latest_enrichment(db, link.id)
    ai = enr.data if enr else {}
    ext = latest_extraction(db, link.id)
    meta = ext.meta if ext else {}
    pricing = ai.get("pricing") or {}

    link.name = _first(ov.get("name"), ai.get("name"), meta.get("site_name"), ext.title if ext else None,
                       link.title, link.domain)
    link.description = _first(ov.get("description"), ai.get("short_description"), meta.get("description"))
    link.tldr = _first(ov.get("tldr"), ai.get("tldr"))
    link.content_type = _first(ov.get("content_type"), ai.get("content_type"))
    if "category" in ov:
        link.category = ensure_category(db, link.user_id, ov.get("category"), ov.get("subcategory"))
    elif ai.get("category"):
        link.category = ensure_category(db, link.user_id, ai.get("category"), ai.get("subcategory"))
    link.has_free_plan = ov["free_plan"] if "free_plan" in ov else (
        pricing.get("free_plan") if pricing.get("verified") else None)
    github = ext.github if ext else None
    link.is_open_source = ov["open_source"] if "open_source" in ov else _first(
        ai.get("is_open_source"), True if github and github.get("license") else None)
    if "tags" in ov:  # user-managed tag set replaces AI tags entirely
        set_tags(db, link, [], "ai")
        set_tags(db, link, ov["tags"], "user")
    elif enr:
        set_tags(db, link, ai.get("tags") or [], "ai")
    refresh_search_document(db, link, ai, ext)


def refresh_search_document(db: Session, link: Link, ai: dict | None = None,
                            ext: ExtractedContent | None = None) -> None:
    if ai is None:
        enr = latest_enrichment(db, link.id)
        ai = enr.data if enr else {}
    ext = ext or latest_extraction(db, link.id)
    cat, sub = category_names(link)
    usage = ai.get("usage") or {}
    features = [f.get("name", "") if isinstance(f, dict) else str(f) for f in ai.get("key_features") or []]
    link.search_primary = "\n".join(filter(None, [
        link.name, link.title, link.domain, link.description, link.tldr, cat, sub, " ".join(link.tags),
    ]))
    link.search_secondary = "\n".join(filter(None, [
        " ".join(features), " ".join(ai.get("problems_solved") or []),
        " ".join(ai.get("target_audience") or []), *[str(v) for v in usage.values() if v],
        link.notes, (ext.markdown[:4000] if ext else None),
    ]))


def embedding_text(link: Link, ai: dict) -> str:
    cat, sub = category_names(link)
    features = [f.get("name", "") if isinstance(f, dict) else str(f) for f in ai.get("key_features") or []]
    parts = [
        link.name, link.description, link.tldr,
        f"Category: {cat} > {sub}" if sub else (f"Category: {cat}" if cat else None),
        ("Tags: " + ", ".join(link.tags)) if link.tags else None,
        ("Features: " + "; ".join(features)) if features else None,
        ("Solves: " + "; ".join(ai.get("problems_solved") or [])) if ai.get("problems_solved") else None,
        ("For: " + ", ".join(ai.get("target_audience") or [])) if ai.get("target_audience") else None,
        link.notes,
    ]
    return "\n".join(p for p in parts if p)[:4000]
