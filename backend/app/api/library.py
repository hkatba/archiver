import io
import json
import re
import uuid
import zipfile
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, aliased

from app.api.common import cards, load_links
from app.api.links import link_markdown
from app.auth import current_user
from app.config import settings
from app.db import get_db
from app.llm import provider_status
from app.models import (
    AIEnrichment,
    Category,
    CodeSnippet,
    Collection,
    CollectionLink,
    ExtractedContent,
    IngestionJob,
    Link,
    LinkStatus,
    LinkTag,
    Tag,
    User,
)
from app.schemas import (
    CollectionIn,
    CollectionLinksIn,
    CollectionOut,
    CollectionPatch,
    Facet,
    LinkList,
    Snippet,
    Stats,
)
from app.search import Filters, search
from app.services import apply_effective, enqueue, get_collection, get_link, latest_enrichment, latest_extraction
from app.urls import InvalidURL, domain_of, normalize_url

router = APIRouter(prefix="/api", tags=["library"])


# ---------------------------------------------------------------- collections


def _rules_filters(rules: dict) -> Filters:
    return Filters(category=rules.get("category"), subcategory=rules.get("subcategory"),
                   tags=rules.get("tags") or [], domain=rules.get("domain"), free_plan=rules.get("free_plan"),
                   open_source=rules.get("open_source"), content_type=rules.get("content_type"))


def collection_link_ids(db: Session, user_id: uuid.UUID, c: Collection, limit: int = 500) -> list[uuid.UUID]:
    if c.rules is None:
        return list(db.scalars(select(CollectionLink.link_id).join(Link).where(
            CollectionLink.collection_id == c.id, Link.deleted_at.is_(None))
            .order_by(CollectionLink.added_at.desc()).limit(limit)))
    filters = _rules_filters(c.rules)
    if c.rules.get("query"):
        return [h.link_id for h in search(db, user_id, c.rules["query"], filters=filters, limit=min(limit, 100),
                                          min_similarity=0.6)]
    return list(db.scalars(filters.apply(select(Link.id), user_id).order_by(Link.created_at.desc()).limit(limit)))


def _collection_out(db: Session, user_id: uuid.UUID, c: Collection) -> CollectionOut:
    return CollectionOut(id=c.id, name=c.name, description=c.description, icon=c.icon, rules=c.rules,
                         is_smart=c.rules is not None, link_count=len(collection_link_ids(db, user_id, c)),
                         created_at=c.created_at)


@router.get("/collections", response_model=list[CollectionOut], tags=["collections"])
def list_collections(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Collection).where(Collection.user_id == user.id).order_by(func.lower(Collection.name)))
    return [_collection_out(db, user.id, c) for c in rows]


@router.post("/collections", response_model=CollectionOut, status_code=201, tags=["collections"])
def create_collection(body: CollectionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = Collection(user_id=user.id, name=body.name.strip(), description=body.description, icon=body.icon,
                   rules=body.rules.model_dump(exclude_none=True) if body.rules else None)
    db.add(c)
    db.commit()
    return _collection_out(db, user.id, c)


@router.get("/collections/{collection_id}", response_model=CollectionOut, tags=["collections"])
def get_collection_detail(collection_id: uuid.UUID, user: User = Depends(current_user),
                          db: Session = Depends(get_db)):
    return _collection_out(db, user.id, get_collection(db, user.id, collection_id))


@router.patch("/collections/{collection_id}", response_model=CollectionOut, tags=["collections"])
def update_collection(collection_id: uuid.UUID, body: CollectionPatch, user: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    c = get_collection(db, user.id, collection_id)
    for f in ("name", "description", "icon"):
        if f in body.model_fields_set and (f != "name" or body.name):
            setattr(c, f, getattr(body, f))
    if "rules" in body.model_fields_set and c.rules is not None and body.rules is not None:
        c.rules = body.rules.model_dump(exclude_none=True)
    db.commit()
    return _collection_out(db, user.id, c)


@router.delete("/collections/{collection_id}", status_code=204, tags=["collections"])
def delete_collection(collection_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(get_collection(db, user.id, collection_id))
    db.commit()


@router.get("/collections/{collection_id}/links", response_model=LinkList, tags=["collections"])
def collection_links(collection_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    ids = collection_link_ids(db, user.id, get_collection(db, user.id, collection_id))
    return LinkList(items=cards(db, load_links(db, ids)), total=len(ids))


@router.post("/collections/{collection_id}/links", tags=["collections"])
def add_to_collection(collection_id: uuid.UUID, body: CollectionLinksIn, user: User = Depends(current_user),
                      db: Session = Depends(get_db)):
    get_collection(db, user.id, collection_id, manual_only=True)
    owned = set(db.scalars(select(Link.id).where(Link.user_id == user.id, Link.id.in_(body.link_ids))))
    added = 0
    for link_id in body.link_ids:
        if link_id in owned and not db.get(CollectionLink, (collection_id, link_id)):
            db.add(CollectionLink(collection_id=collection_id, link_id=link_id))
            added += 1
    db.commit()
    return {"added": added}


@router.delete("/collections/{collection_id}/links/{link_id}", status_code=204, tags=["collections"])
def remove_from_collection(collection_id: uuid.UUID, link_id: uuid.UUID, user: User = Depends(current_user),
                           db: Session = Depends(get_db)):
    get_collection(db, user.id, collection_id, manual_only=True)
    db.execute(delete(CollectionLink).where(CollectionLink.collection_id == collection_id,
                                            CollectionLink.link_id == link_id))
    db.commit()


# ---------------------------------------------------------------- facets


def category_tree(db: Session, user_id: uuid.UUID) -> list[Facet]:
    parent = aliased(Category)
    rows = db.execute(
        select(func.coalesce(parent.name, Category.name).label("top"),
               func.nullif(func.coalesce(parent.name, ""), "").label("has_parent"),
               Category.name, func.count(Link.id))
        .select_from(Link).join(Category, Link.category_id == Category.id)
        .outerjoin(parent, Category.parent_id == parent.id)
        .where(Link.user_id == user_id, Link.deleted_at.is_(None))
        .group_by("top", "has_parent", Category.name)).all()
    tops: dict[str, Facet] = {}
    for top, has_parent, name, count in rows:
        f = tops.setdefault(top, Facet(name=top, count=0, children=[]))
        f.count += count
        if has_parent:
            f.children.append(Facet(name=name, count=count))
    for f in tops.values():
        f.children.sort(key=lambda c: -c.count)
    return sorted(tops.values(), key=lambda f: -f.count)


@router.get("/categories", response_model=list[Facet], tags=["facets"])
def categories(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return category_tree(db, user.id)


def tag_counts(db: Session, user_id: uuid.UUID, limit: int | None = None) -> list[Facet]:
    stmt = (select(Tag.name, func.count(LinkTag.link_id).label("n")).join(LinkTag).join(Link)
            .where(Tag.user_id == user_id, Link.deleted_at.is_(None))
            .group_by(Tag.name).order_by(func.count(LinkTag.link_id).desc(), Tag.name))
    if limit:
        stmt = stmt.limit(limit)
    return [Facet(name=n, count=c) for n, c in db.execute(stmt).all()]


@router.get("/tags", response_model=list[Facet], tags=["facets"])
def tags(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return tag_counts(db, user.id)


@router.get("/domains", response_model=list[Facet], tags=["facets"])
def domains(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Link.domain, func.count()).where(Link.user_id == user.id, Link.deleted_at.is_(None))
                      .group_by(Link.domain).order_by(func.count().desc()).limit(200)).all()
    return [Facet(name=d, count=c) for d, c in rows]


@router.get("/snippets", response_model=list[Snippet], tags=["snippets"])
def snippets(q: str | None = Query(None, max_length=200), language: str | None = None,
             limit: int = Query(60, ge=1, le=200), offset: int = Query(0, ge=0),
             user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = (select(CodeSnippet, Link.name).join(Link, CodeSnippet.link_id == Link.id)
            .where(Link.user_id == user.id, Link.deleted_at.is_(None)))
    if language:
        stmt = stmt.where(CodeSnippet.language == language.lower())
    if q:
        like = f"%{q}%"
        stmt = stmt.where(CodeSnippet.code.ilike(like) | CodeSnippet.context.ilike(like) | Link.name.ilike(like))
    rows = db.execute(stmt.order_by(Link.created_at.desc(), CodeSnippet.position).limit(limit).offset(offset))
    return [Snippet(id=s.id, link_id=s.link_id, language=s.language, code=s.code, context=s.context,
                    link_name=name) for s, name in rows]


# ---------------------------------------------------------------- dashboard


@router.get("/stats", response_model=Stats, tags=["dashboard"])
def stats(user: User = Depends(current_user), db: Session = Depends(get_db)):
    alive = (Link.user_id == user.id, Link.deleted_at.is_(None))
    by_status = {s.value: c for s, c in db.execute(
        select(Link.status, func.count()).where(*alive).group_by(Link.status)).all()}
    total = sum(by_status.values())
    active = sum(by_status.get(s, 0) for s in ("PENDING", "QUEUED", "PROCESSING", "ENRICHING", "INDEXING"))
    recent = db.scalars(select(Link).where(*alive).order_by(Link.created_at.desc()).limit(8)).unique().all()
    accessed = db.scalars(select(Link).where(*alive, Link.last_accessed_at.is_not(None))
                          .order_by(Link.last_accessed_at.desc()).limit(6)).unique().all()
    tree = category_tree(db, user.id)

    suggestions = []
    existing = {n.lower() for n in db.scalars(select(Collection.name).where(Collection.user_id == user.id))}
    for top in tree:
        for sub in top.children:
            if sub.count >= 3 and sub.name.lower() not in existing:
                suggestions.append({"type": "smart_collection", "name": sub.name, "count": sub.count,
                                    "rules": {"subcategory": sub.name},
                                    "message": f"You have {sub.count} {sub.name} links. Group them in a smart "
                                               f"collection that updates automatically."})
    suggestions.sort(key=lambda s: -s["count"])
    suggestions = suggestions[:4]
    dupes = db.scalar(select(func.count()).where(*alive, Link.duplicate_of_id.is_not(None)))
    if dupes:
        suggestions.append({"type": "duplicates", "count": dupes,
                            "message": f"{dupes} saved link(s) point to the same page as another link."})
    if by_status.get("FAILED"):
        suggestions.append({"type": "retry_failed", "count": by_status["FAILED"],
                            "message": f"{by_status['FAILED']} link(s) failed to process."})

    tok = db.execute(select(AIEnrichment.provider, func.count(), func.sum(AIEnrichment.tokens_in),
                            func.sum(AIEnrichment.tokens_out)).join(Link).where(Link.user_id == user.id)
                     .group_by(AIEnrichment.provider)).all()
    return Stats(
        total=total, completed=by_status.get("COMPLETED", 0), in_progress=active,
        failed=by_status.get("FAILED", 0), blocked=by_status.get("BLOCKED", 0),
        needs_review=by_status.get("NEEDS_REVIEW", 0),
        favorites=db.scalar(select(func.count()).where(*alive, Link.is_favorite.is_(True))),
        by_status=by_status, categories=tree, top_tags=tag_counts(db, user.id, 24),
        recent=cards(db, list(recent)), recently_accessed=cards(db, list(accessed)), suggestions=suggestions,
        ai=provider_status(),
        tokens={p: {"analyses": n, "input": int(i or 0), "output": int(o or 0)} for p, n, i, o in tok},
    )


@router.get("/system/status", tags=["system"])
def system_status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    queue = {s.value: c for s, c in db.execute(
        select(IngestionJob.status, func.count()).where(IngestionJob.user_id == user.id)
        .group_by(IngestionJob.status)).all()}
    return {
        "ai": provider_status(),
        "embeddings": {"provider": settings.embedding_provider, "model": settings.embedding_model},
        "browser_enabled": settings.browser_enabled, "respect_robots_txt": settings.respect_robots_txt,
        "github_token": settings.github_token is not None, "queue": queue,
    }


# ---------------------------------------------------------------- export / import


def _export_link(db: Session, link: Link) -> dict:
    from app.services import category_names

    enr = latest_enrichment(db, link.id)
    ext = latest_extraction(db, link.id)
    cat, sub = category_names(link)
    return {
        "url": link.url, "name": link.name, "title": link.title, "description": link.description,
        "tldr": link.tldr, "category": cat, "subcategory": sub, "tags": link.tags, "notes": link.notes,
        "is_favorite": link.is_favorite, "overrides": link.overrides, "status": link.status.value,
        "created_at": link.created_at.isoformat(),
        "ai": {"provider": enr.provider, "model": enr.model, "data": enr.data} if enr else None,
        "content": {"method": ext.method, "final_url": ext.final_url, "canonical_url": ext.canonical_url,
                    "title": ext.title, "meta": ext.meta, "markdown": ext.markdown, "headings": ext.headings,
                    "tech_stack": ext.tech_stack, "github": ext.github} if ext else None,
    }


@router.get("/export", tags=["export"], summary="Export the library (JSON backup or Markdown vault zip)")
def export(format: Literal["json", "markdown"] = "json", user: User = Depends(current_user),
           db: Session = Depends(get_db)):
    links = db.scalars(select(Link).where(Link.user_id == user.id, Link.deleted_at.is_(None))
                       .order_by(Link.created_at)).unique().all()
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    if format == "markdown":
        buf = io.BytesIO()
        used: set[str] = set()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for link in links:
                base = re.sub(r'[\\/:*?"<>|#^\[\]]+', "-", link.name or link.domain).strip(" -.")[:80] or "link"
                name, n = base, 2
                while name.lower() in used:
                    name, n = f"{base} {n}", n + 1
                used.add(name.lower())
                zf.writestr(f"cairn/{name}.md", link_markdown(db, link))
        return Response(buf.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="cairn-markdown-{stamp}.zip"'})
    collections = db.scalars(select(Collection).where(Collection.user_id == user.id)).all()
    payload = {
        "format": "cairn-export", "version": 1, "exported_at": datetime.now(UTC).isoformat(),
        "links": [_export_link(db, link) for link in links],
        "collections": [{"name": c.name, "description": c.description, "icon": c.icon, "rules": c.rules,
                         "urls": [db.get(Link, i).url for i in collection_link_ids(db, user.id, c)]
                         if c.rules is None else []} for c in collections],
    }
    return Response(json.dumps(payload, ensure_ascii=False, default=str), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="cairn-backup-{stamp}.json"'})


@router.post("/import", tags=["export"], summary="Restore a JSON export (skips URLs already in the library)")
def import_backup(payload: dict = Body(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    if payload.get("format") != "cairn-export":
        raise HTTPException(422, "Not a Cairn export file")
    existing = set(db.scalars(select(Link.normalized_url).where(Link.user_id == user.id,
                                                                Link.deleted_at.is_(None))))
    by_url: dict[str, uuid.UUID] = {}
    restored = skipped = 0
    for item in payload.get("links", [])[:20000]:
        try:
            normalized = normalize_url(str(item.get("url", "")))
        except InvalidURL:
            skipped += 1
            continue
        if normalized in existing:
            skipped += 1
            continue
        existing.add(normalized)
        link = Link(user_id=user.id, url=str(item["url"])[:4096], normalized_url=normalized,
                    domain=domain_of(normalized), notes=item.get("notes"), is_favorite=bool(item.get("is_favorite")),
                    overrides=item.get("overrides") or {}, title=item.get("title"), status=LinkStatus.QUEUED)
        db.add(link)
        db.flush()
        content = item.get("content")
        if content:
            md = str(content.get("markdown") or "")
            db.add(ExtractedContent(
                link_id=link.id, method=f"import:{content.get('method', '')}"[:20], final_url=content.get("final_url"),
                canonical_url=content.get("canonical_url"), title=content.get("title"),
                meta=content.get("meta") or {}, markdown=md, text_length=len(md),
                content_hash=__import__("hashlib").sha256(md.encode()).hexdigest(),
                headings=content.get("headings") or [], tech_stack=content.get("tech_stack") or [],
                github=content.get("github")))
        if item.get("ai") and isinstance(item["ai"].get("data"), dict):
            db.add(AIEnrichment(link_id=link.id, provider=str(item["ai"].get("provider", "import"))[:40],
                                model=str(item["ai"].get("model", ""))[:120], prompt_version="import",
                                input_hash="", data=item["ai"]["data"]))
        db.flush()
        if content or item.get("ai"):
            apply_effective(db, link)
            enqueue(db, link, resume_from="index")  # rebuild the embedding locally
        else:
            enqueue(db, link)
        by_url[str(item["url"])] = link.id
        restored += 1
    for c in payload.get("collections", [])[:500]:
        col = Collection(user_id=user.id, name=str(c.get("name", "Imported"))[:120], description=c.get("description"),
                         icon=c.get("icon"), rules=c.get("rules"))
        db.add(col)
        db.flush()
        for url in c.get("urls") or []:
            if url in by_url:
                db.add(CollectionLink(collection_id=col.id, link_id=by_url[url]))
    db.commit()
    return {"restored": restored, "skipped": skipped}


@router.get("/links/{link_id}/export.json", tags=["export"], include_in_schema=False)
def export_one(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _export_link(db, get_link(db, user.id, link_id))
