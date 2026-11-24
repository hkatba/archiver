import uuid

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import Link
from app.schemas import LinkCard
from app.services import category_names


def github_summaries(db: Session, links: list[Link]) -> dict[uuid.UUID, dict]:
    ids = [link.id for link in links if link.domain == "github.com"]
    if not ids:
        return {}
    rows = db.execute(text(
        "SELECT DISTINCT ON (link_id) link_id, github FROM extracted_contents "
        "WHERE link_id = ANY(:ids) AND github IS NOT NULL ORDER BY link_id, created_at DESC"), {"ids": ids}).all()
    keep = ("full_name", "stars", "forks", "language", "license", "archived", "pushed_at", "latest_release")
    return {r.link_id: {k: r.github.get(k) for k in keep} for r in rows}


def card(link: Link, github: dict | None = None) -> LinkCard:
    cat, sub = category_names(link)
    base = f"/api/links/{link.id}"
    v = int(link.updated_at.timestamp()) if link.updated_at else 0
    return LinkCard(
        id=link.id, url=link.url, normalized_url=link.normalized_url, domain=link.domain, name=link.name,
        title=link.title, description=link.description, category=cat, subcategory=sub, tags=link.tags,
        content_type=link.content_type, status=link.status, status_detail=link.status_detail,
        is_favorite=link.is_favorite, availability=link.availability, has_free_plan=link.has_free_plan,
        is_open_source=link.is_open_source,
        favicon=f"{base}/favicon?v={v}" if link.favicon_key else None,
        thumbnail=f"{base}/thumbnail?v={v}" if link.thumbnail_key else None,
        duplicate_of_id=link.duplicate_of_id, created_at=link.created_at, updated_at=link.updated_at,
        github=github,
    )


def cards(db: Session, links: list[Link]) -> list[LinkCard]:
    gh = github_summaries(db, links)
    return [card(link, gh.get(link.id)) for link in links]


def load_links(db: Session, ids: list[uuid.UUID]) -> list[Link]:
    """Load links preserving the order of `ids`."""
    by_id = {link.id: link for link in db.scalars(select(Link).where(Link.id.in_(ids)))}
    return [by_id[i] for i in ids if i in by_id]
