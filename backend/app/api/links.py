import re
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.common import card, cards
from app.auth import current_user, ingest_limiter
from app.db import get_db
from app.embeddings import get_embedder
from app.models import (
    CodeSnippet,
    Collection,
    CollectionLink,
    IngestionJob,
    Link,
    LinkStatus,
    ProcessingLog,
    User,
)
from app.pipeline import check_availability
from app.schemas import (
    BulkIn,
    BulkOut,
    CollectionRef,
    LinkCard,
    LinkDetail,
    LinkIn,
    LinkList,
    LinkPatch,
    LogEntry,
    MergeIn,
    PreviewIn,
    PreviewItemOut,
    PreviewOut,
    Snippet,
)
from app.search import Filters, related
from app.services import (
    add_links,
    apply_effective,
    embedding_text,
    enqueue,
    get_link,
    latest_enrichment,
    latest_extraction,
    preview_urls,
    set_tags,
)
from app.storage import storage
from app.urls import InvalidURL, extract_urls, normalize_url

router = APIRouter(prefix="/api/links", tags=["links"])

OVERRIDE_FIELDS = ("name", "description", "tldr", "category", "subcategory", "tags", "content_type", "free_plan",
                   "open_source")


def _preview_out(item) -> PreviewItemOut:
    return PreviewItemOut(**item.__dict__)


@router.post("/preview", response_model=PreviewOut, summary="Validate and dedupe URLs before importing")
def preview(body: PreviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = preview_urls(db, user.id, extract_urls(body.text)[:5000])
    new = sum(1 for i in items if i.valid and not i.duplicate_of and not i.duplicate_in_batch)
    invalid = sum(1 for i in items if not i.valid)
    return PreviewOut(items=[_preview_out(i) for i in items], total=len(items), new=new, invalid=invalid,
                      duplicates=len(items) - new - invalid)


@router.post("", response_model=LinkCard, status_code=201, summary="Save one URL",
             responses={409: {"description": "Already saved; body contains the existing link"}})
def create_link(body: LinkIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ingest_limiter.check(f"ingest:{user.id}")
    result = add_links(db, user.id, [body.url], body.collection_id, body.notes)
    if result.invalid:
        raise HTTPException(422, result.invalid[0].error)
    if result.duplicates:
        existing = db.get(Link, result.duplicates[0].duplicate_of)
        return JSONResponse(status_code=409, content={"detail": "This URL is already in your library",
                                                      "link": card(existing).model_dump(mode="json")})
    return card(result.created[0])


@router.post("/bulk", response_model=BulkOut, status_code=201, summary="Save many URLs at once")
def create_bulk(body: BulkIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ingest_limiter.check(f"ingest:{user.id}")
    result = add_links(db, user.id, body.urls, body.collection_id)
    return BulkOut(created=cards(db, result.created), duplicates=[_preview_out(i) for i in result.duplicates],
                   invalid=[_preview_out(i) for i in result.invalid])


@router.get("", response_model=LinkList, summary="List links with filters")
def list_links(
    q: str | None = Query(None, max_length=200, description="Quick filter on name, title and domain"),
    category: str | None = None, subcategory: str | None = None, tag: list[str] = Query([]),
    domain: str | None = None, collection_id: uuid.UUID | None = None, status: LinkStatus | None = None,
    favorite: bool | None = None, free_plan: bool | None = None, open_source: bool | None = None,
    availability: str | None = None, deleted: bool = False, duplicates: bool = False,
    sort: Literal["created_desc", "created_asc", "name", "accessed", "updated"] = "created_desc",
    limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    filters = Filters(category=category, subcategory=subcategory, tags=tag, domain=domain,
                      collection_id=collection_id, status=status, favorite=favorite, free_plan=free_plan,
                      open_source=open_source, availability=availability)
    if deleted:  # trash view
        stmt = select(Link).where(Link.user_id == user.id, Link.deleted_at.is_not(None))
    else:
        stmt = filters.apply(select(Link), user.id)
    if duplicates:
        stmt = stmt.where(Link.duplicate_of_id.is_not(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where((Link.name.ilike(like)) | (Link.title.ilike(like)) | (Link.domain.ilike(like))
                          | (Link.url.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    order = {
        "created_desc": Link.created_at.desc(), "created_asc": Link.created_at.asc(),
        "name": func.lower(Link.name).asc(), "accessed": Link.last_accessed_at.desc().nulls_last(),
        "updated": Link.updated_at.desc(),
    }[sort]
    links = list(db.scalars(stmt.order_by(order, Link.id).limit(limit).offset(offset)).unique())
    return LinkList(items=cards(db, links), total=total)


@router.get("/lookup", response_model=LinkCard | None, summary="Is this URL already saved? (browser extension)")
def lookup(url: str = Query(max_length=4096), user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        normalized = normalize_url(url)
    except InvalidURL as e:
        raise HTTPException(422, str(e)) from None
    link = db.scalar(select(Link).where(Link.user_id == user.id, Link.deleted_at.is_(None),
                                        (Link.normalized_url == normalized) | (Link.canonical_url == url)))
    return card(link) if link else None


@router.post("/retry-failed", summary="Retry every FAILED link")
def retry_failed(user: User = Depends(current_user), db: Session = Depends(get_db)):
    links = db.scalars(select(Link).where(Link.user_id == user.id, Link.deleted_at.is_(None),
                                          Link.status == LinkStatus.FAILED)).all()
    queued = sum(1 for link in links if enqueue(db, link, resume_from=_resume_stage(db, link)))
    db.commit()
    return {"queued": queued}


def _resume_stage(db: Session, link: Link) -> str:
    job = db.scalar(select(IngestionJob).where(IngestionJob.link_id == link.id)
                    .order_by(IngestionJob.created_at.desc()).limit(1))
    return job.resume_from if job and link.status == LinkStatus.FAILED else "extract"


@router.get("/{link_id}", response_model=LinkDetail)
def get_detail(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id, include_deleted=True)
    db.execute(update(Link).where(Link.id == link.id).values(last_accessed_at=datetime.now(UTC),
                                                             updated_at=Link.updated_at))
    db.commit()
    ext = latest_extraction(db, link.id)
    enr = latest_enrichment(db, link.id)
    snippets = db.scalars(select(CodeSnippet).where(CodeSnippet.link_id == link.id)
                          .order_by(CodeSnippet.position)).all()
    collections = db.execute(select(Collection.id, Collection.name).join(CollectionLink).where(
        CollectionLink.link_id == link.id)).all()
    logs = db.scalars(select(ProcessingLog).where(ProcessingLog.link_id == link.id)
                      .order_by(ProcessingLog.id.desc()).limit(40)).all()
    last_job = db.scalar(select(IngestionJob).where(IngestionJob.link_id == link.id)
                         .order_by(IngestionJob.created_at.desc()).limit(1))
    base = card(link, ext.github if ext and ext.github else None)
    return LinkDetail(
        **base.model_dump(), tldr=link.tldr, final_url=link.final_url, canonical_url=link.canonical_url,
        screenshot=f"/api/links/{link.id}/screenshot?v={int(link.updated_at.timestamp())}"
        if link.screenshot_key else None,
        image_url=link.image_url, notes=link.notes, overrides=link.overrides or {}, http_status=link.http_status,
        last_checked_at=link.last_checked_at, last_processed_at=link.last_processed_at,
        ai={"provider": enr.provider, "model": enr.model, "created_at": enr.created_at, "data": enr.data,
            "tokens_in": enr.tokens_in, "tokens_out": enr.tokens_out} if enr else None,
        extraction={"method": ext.method, "partial": ext.partial, "http_status": ext.http_status,
                    "meta": ext.meta, "headings": ext.headings, "tech_stack": ext.tech_stack,
                    "text_length": ext.text_length, "created_at": ext.created_at} if ext else None,
        markdown=ext.markdown if ext else None,
        snippets=[Snippet(id=s.id, link_id=s.link_id, language=s.language, code=s.code, context=s.context)
                  for s in snippets],
        collections=[CollectionRef(id=c.id, name=c.name) for c in collections],
        logs=[LogEntry(stage=lg.stage, level=lg.level, message=lg.message, data=lg.data, created_at=lg.created_at)
              for lg in logs],
        last_error=last_job.last_error if last_job else None,
    )


def reembed(db: Session, link: Link) -> None:
    if link.embedding is None:
        return  # not indexed yet; the pipeline will embed it
    enr = latest_enrichment(db, link.id)
    embedder = get_embedder()
    link.embedding = embedder.documents([embedding_text(link, enr.data if enr else {})])[0]
    link.embedding_model = embedder.name


@router.patch("/{link_id}", response_model=LinkCard, summary="Edit metadata (user edits override AI values)")
def patch_link(link_id: uuid.UUID, body: LinkPatch, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id)
    fields = body.model_fields_set
    overrides = dict(link.overrides or {})
    for f in OVERRIDE_FIELDS:
        if f in fields:
            value = getattr(body, f)
            if value is None:
                overrides.pop(f, None)
            else:
                overrides[f] = value
    if "category" in overrides and "subcategory" not in fields and "category" in fields:
        overrides.pop("subcategory", None)
    if "tags" in fields and body.tags is None:
        set_tags(db, link, [], "user")  # back to AI tags
    link.overrides = overrides
    if "notes" in fields:
        link.notes = body.notes
    if "is_favorite" in fields and body.is_favorite is not None:
        link.is_favorite = body.is_favorite
    if fields - {"is_favorite"}:
        apply_effective(db, link)
        reembed(db, link)
    db.commit()
    db.refresh(link)
    return card(link)


@router.delete("/{link_id}", status_code=204, summary="Move to trash (soft delete)")
def delete_link(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id)
    link.deleted_at = datetime.now(UTC)
    db.commit()


@router.post("/{link_id}/restore", response_model=LinkCard)
def restore_link(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id, include_deleted=True)
    link.deleted_at = None
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This URL was saved again after it was deleted") from None
    return card(link)


@router.post("/{link_id}/retry", response_model=LinkCard, summary="Retry from the stage that failed")
def retry_link(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id)
    if not enqueue(db, link, resume_from=_resume_stage(db, link)):
        raise HTTPException(409, "This link is already being processed")
    db.commit()
    return card(link)


@router.post("/{link_id}/reprocess", response_model=LinkCard, summary="Re-extract and re-analyze from scratch")
def reprocess_link(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id)
    if not enqueue(db, link, resume_from="extract", kind="reprocess"):
        raise HTTPException(409, "This link is already being processed")
    db.commit()
    return card(link)


@router.post("/{link_id}/regenerate", response_model=LinkCard, summary="Re-run AI analysis only")
def regenerate_link(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id)
    if latest_extraction(db, link.id) is None:
        raise HTTPException(409, "Nothing extracted yet; use reprocess")
    if not enqueue(db, link, resume_from="enrich", kind="reprocess"):
        raise HTTPException(409, "This link is already being processed")
    db.commit()
    return card(link)


@router.post("/{link_id}/check", summary="Check availability now")
async def check_link(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = await run_in_threadpool(get_link, db, user.id, link_id)
    return await check_availability(link.id)


@router.get("/{link_id}/related", response_model=list[dict])
def related_links(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id)
    pairs = related(db, link)
    by_id = {lk.id: lk for lk in db.scalars(select(Link).where(Link.id.in_([p[0] for p in pairs])))}
    return [{"link": card(by_id[i]).model_dump(mode="json"), "similarity": round(s, 3)} for i, s in pairs]


@router.post("/{link_id}/merge", response_model=LinkCard,
             summary="Merge this link into another (keeps notes, tags, collections, favorite)")
def merge_link(link_id: uuid.UUID, body: MergeIn, user: User = Depends(current_user),
               db: Session = Depends(get_db)):
    if link_id == body.into_id:
        raise HTTPException(400, "Can't merge a link into itself")
    src = get_link(db, user.id, link_id)
    dst = get_link(db, user.id, body.into_id)
    if src.notes:
        dst.notes = f"{dst.notes}\n\n{src.notes}" if dst.notes else src.notes
    dst.is_favorite = dst.is_favorite or src.is_favorite
    user_tags = sorted({*src.tags, *dst.tags}) if "tags" in (src.overrides or {}) or "tags" in (
        dst.overrides or {}) else None
    for cl in db.scalars(select(CollectionLink).where(CollectionLink.link_id == src.id)).all():
        if not db.get(CollectionLink, (cl.collection_id, dst.id)):
            db.add(CollectionLink(collection_id=cl.collection_id, link_id=dst.id))
    if user_tags is not None:
        dst.overrides = {**(dst.overrides or {}), "tags": user_tags}
    src.deleted_at = datetime.now(UTC)
    db.execute(update(Link).where(Link.duplicate_of_id == src.id).values(duplicate_of_id=None))
    if dst.duplicate_of_id == src.id:
        dst.duplicate_of_id = None
    db.flush()
    apply_effective(db, dst)
    reembed(db, dst)
    db.commit()
    return card(dst)


def _file(link: Link, key: str | None, media_type: str):
    if not key:
        raise HTTPException(404, "Not available")
    path = storage.path(key)
    if not path.exists():
        raise HTTPException(404, "File missing")
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "private, max-age=86400",
                                                              "X-Content-Type-Options": "nosniff"})


@router.get("/{link_id}/screenshot", response_class=FileResponse)
def screenshot(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id, include_deleted=True)
    return _file(link, link.screenshot_key, "image/jpeg")


@router.get("/{link_id}/thumbnail", response_class=FileResponse)
def thumbnail(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id, include_deleted=True)
    return _file(link, link.thumbnail_key, "image/webp")


@router.get("/{link_id}/favicon", response_class=FileResponse)
def favicon(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id, include_deleted=True)
    return _file(link, link.favicon_key, "image/png")


def link_markdown(db: Session, link: Link) -> str:
    """Self-contained Markdown note (YAML front matter: Obsidian/Logseq friendly)."""
    from app.services import category_names

    enr = latest_enrichment(db, link.id)
    ext = latest_extraction(db, link.id)
    ai = enr.data if enr else {}
    cat, sub = category_names(link)

    def y(v) -> str:
        return '"' + str(v).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'

    lines = ["---", f"title: {y(link.name or link.domain)}", f"url: {y(link.url)}", f"domain: {y(link.domain)}"]
    if cat:
        lines.append(f"category: {y(cat + (' / ' + sub if sub else ''))}")
    if link.tags:
        lines.append("tags: [" + ", ".join(y(re.sub(r'\s+', '-', t)) for t in link.tags) + "]")
    if link.has_free_plan is not None:
        lines.append(f"free_plan: {str(link.has_free_plan).lower()}")
    lines += [f"saved: {link.created_at:%Y-%m-%d}", f"cairn_id: {link.id}", "---", "",
              f"# {link.name or link.domain}", "", f"<{link.url}>", ""]
    if link.tldr:
        lines += ["## TL;DR", "", link.tldr, ""]
    if link.description:
        lines += ["## What it does", "", link.description, ""]
    for title, key in (("Problems it solves", "problems_solved"), ("Who it's for", "target_audience")):
        if ai.get(key):
            lines += [f"## {title}", "", *[f"- {x}" for x in ai[key]], ""]
    if ai.get("key_features"):
        lines += ["## Key features", "",
                  *[f"- {f['name']}" + ("" if f.get("verified") else " _(unverified)_") for f in ai["key_features"]],
                  ""]
    if link.notes:
        lines += ["## My notes", "", link.notes, ""]
    if ext and ext.markdown:
        lines += ["## Archived content", "", ext.markdown, ""]
    return "\n".join(lines)


@router.get("/{link_id}/markdown", summary="Download as Markdown")
def download_markdown(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = get_link(db, user.id, link_id, include_deleted=True)
    name = re.sub(r"[^\w.-]+", "-", (link.name or link.domain)).strip("-")[:80] or "link"
    return Response(link_markdown(db, link), media_type="text/markdown; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}.md"'})
