"""Hybrid search: pgvector cosine similarity + Postgres full-text, fused with Reciprocal Rank Fusion.

Each result carries human-readable reasons (semantic strength, matched keywords, category/tag hits).
"""

import re
import uuid
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import Select, Text, and_, cast, func, or_, select, text
from sqlalchemy.orm import Session

from app.embeddings import get_embedder
from app.models import Category, CollectionLink, Link, LinkStatus, LinkTag, Tag

Mode = Literal["hybrid", "semantic", "keyword"]

# Words that describe the *request* rather than the tool; in hybrid mode they would keyword-match everything
FILLER = {
    "i", "im", "need", "needs", "want", "wants", "looking", "look", "find", "finding", "a", "an", "the", "to", "for",
    "of", "tool", "tools", "app", "apps", "website", "websites", "site", "sites", "something", "some", "that",
    "which", "what", "can", "could", "help", "helps", "me", "my", "saved", "have", "do", "does", "any", "best",
    "good", "way", "use", "using", "make", "makes", "let", "lets", "is", "are", "with", "and", "or", "in", "on",
    "please", "show", "list", "there", "anything", "thing", "things", "service", "services",
}
RRF_K = 60
CANDIDATES = 60


@dataclass
class Filters:
    category: str | None = None
    subcategory: str | None = None
    tags: list[str] = field(default_factory=list)
    domain: str | None = None
    collection_id: uuid.UUID | None = None
    status: LinkStatus | None = None
    favorite: bool | None = None
    free_plan: bool | None = None
    open_source: bool | None = None
    content_type: str | None = None
    availability: str | None = None
    created_after: str | None = None
    created_before: str | None = None

    def apply(self, stmt: Select, user_id: uuid.UUID) -> Select:
        stmt = stmt.where(Link.user_id == user_id, Link.deleted_at.is_(None))
        if self.subcategory:
            stmt = stmt.where(Link.category_id.in_(select(Category.id).where(
                Category.user_id == user_id, Category.name == self.subcategory, Category.parent_id.is_not(None))))
        elif self.category:
            top = select(Category.id).where(Category.user_id == user_id, Category.name == self.category,
                                            Category.parent_id.is_(None))
            stmt = stmt.where(or_(Link.category_id.in_(top),
                                  Link.category_id.in_(select(Category.id).where(Category.parent_id.in_(top)))))
        for tag in self.tags:
            stmt = stmt.where(Link.id.in_(select(LinkTag.link_id).join(Tag).where(
                Tag.user_id == user_id, Tag.name == tag.lower())))
        if self.domain:
            stmt = stmt.where(Link.domain == self.domain.lower().removeprefix("www."))
        if self.collection_id:
            stmt = stmt.where(Link.id.in_(select(CollectionLink.link_id).where(
                CollectionLink.collection_id == self.collection_id)))
        if self.status:
            stmt = stmt.where(Link.status == self.status)
        if self.favorite is not None:
            stmt = stmt.where(Link.is_favorite.is_(self.favorite))
        if self.free_plan is not None:
            stmt = stmt.where(Link.has_free_plan.is_(self.free_plan))
        if self.open_source is not None:
            stmt = stmt.where(Link.is_open_source.is_(self.open_source))
        if self.content_type:
            stmt = stmt.where(Link.content_type == self.content_type)
        if self.availability:
            stmt = stmt.where(Link.availability == self.availability)
        if self.created_after:
            stmt = stmt.where(Link.created_at >= self.created_after)
        if self.created_before:
            stmt = stmt.where(Link.created_at <= self.created_before)
        return stmt


@dataclass
class Hit:
    link_id: uuid.UUID
    score: float
    similarity: float | None = None
    keyword_rank: float | None = None
    reasons: list[str] = field(default_factory=list)


def _strength(sim: float) -> str:
    return "Strong" if sim >= 0.75 else "Good" if sim >= 0.65 else "Partial"


def search(db: Session, user_id: uuid.UUID, query: str, *, mode: Mode = "hybrid", filters: Filters | None = None,
           limit: int = 20, min_similarity: float = 0.55) -> list[Hit]:
    filters = filters or Filters()
    query = query.strip()
    hits: dict[uuid.UUID, Hit] = {}

    if mode in ("hybrid", "semantic") and query:
        qvec = get_embedder().query(query)
        distance = Link.embedding.cosine_distance(qvec)
        stmt = filters.apply(select(Link.id, (1 - distance).label("sim")), user_id).where(
            Link.embedding.is_not(None)).order_by(distance).limit(CANDIDATES)
        rows = [r for r in db.execute(stmt).all() if r.sim >= min_similarity]
        for rank, r in enumerate(rows):
            h = hits.setdefault(r.id, Hit(r.id, 0.0))
            h.similarity = float(r.sim)
            h.score += 1 / (RRF_K + rank + 1)

    kw_query = query if mode == "keyword" else " ".join(
        w for w in re.findall(r"[\w'-]+", query) if w.lower().strip("'") not in FILLER)
    if mode in ("hybrid", "keyword") and kw_query:
        # keyword mode: AND semantics with quotes / -exclusions; hybrid: OR of meaningful terms (ranked by coverage)
        tsq = (func.websearch_to_tsquery("english", kw_query) if mode == "keyword" else
               func.to_tsquery("english", func.replace(cast(func.plainto_tsquery("english", kw_query), Text),
                                                       "&", "|")))
        rank_expr = func.ts_rank_cd(Link.search_tsv, tsq, 32)
        stmt = filters.apply(select(Link.id, rank_expr.label("rank")), user_id).where(
            Link.search_tsv.op("@@")(tsq)).order_by(rank_expr.desc()).limit(CANDIDATES)
        for rank, r in enumerate(db.execute(stmt).all()):
            h = hits.setdefault(r.id, Hit(r.id, 0.0))
            h.keyword_rank = float(r.rank)
            h.score += 1 / (RRF_K + rank + 1)

    if not query:  # filters only
        stmt = filters.apply(select(Link.id), user_id).order_by(Link.created_at.desc()).limit(limit)
        return [Hit(r.id, 0.0, reasons=["Matches filters"]) for r in db.execute(stmt).all()]

    ranked = sorted(hits.values(), key=lambda h: h.score, reverse=True)[:limit]
    _explain(db, kw_query or query, ranked)
    return ranked


def _explain(db: Session, query: str, hits: list[Hit]) -> None:
    if not hits:
        return
    query_lexemes = set(db.scalars(text("SELECT lexeme FROM unnest(to_tsvector('english', :q))"),
                                   {"q": query}).all())
    ids = [h.link_id for h in hits]
    doc_lexemes: dict[uuid.UUID, set[str]] = {}
    if query_lexemes:
        rows = db.execute(text(
            "SELECT id, array(SELECT lexeme FROM unnest(search_tsv) WHERE lexeme = ANY(:lex)) AS hit "
            "FROM links WHERE id = ANY(:ids)"), {"lex": list(query_lexemes), "ids": ids}).all()
        doc_lexemes = {r.id: set(r.hit) for r in rows}
    links = {link.id: link for link in db.scalars(select(Link).where(Link.id.in_(ids)))}
    for h in hits:
        link = links[h.link_id]
        if h.similarity is not None:
            h.reasons.append(f"{_strength(h.similarity)} semantic match ({h.similarity:.2f})")
        matched = sorted(doc_lexemes.get(h.link_id, set()))
        if matched:
            h.reasons.append("Keywords: " + ", ".join(matched[:6]))
        cat = link.category
        if cat:
            names = {cat.name.lower(), (cat.parent.name.lower() if cat.parent else "")}
            if any(lex in " ".join(names) for lex in query_lexemes):
                h.reasons.append(f"Category: {cat.name}")
        tag_hits = [t for t in link.tags if any(lex in t for lex in query_lexemes)]
        if tag_hits:
            h.reasons.append("Tags: " + ", ".join(tag_hits[:4]))


def related(db: Session, link: Link, limit: int = 6, min_similarity: float = 0.6) -> list[tuple[uuid.UUID, float]]:
    if link.embedding is None:
        return []
    distance = Link.embedding.cosine_distance(link.embedding)
    rows = db.execute(select(Link.id, (1 - distance).label("sim")).where(
        and_(Link.user_id == link.user_id, Link.deleted_at.is_(None), Link.id != link.id,
             Link.embedding.is_not(None))).order_by(distance).limit(limit)).all()
    return [(r.id, float(r.sim)) for r in rows if r.sim >= min_similarity]
