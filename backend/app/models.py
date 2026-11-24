"""Database models. See DATABASE_SCHEMA.md for the entity overview."""

import enum
import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.config import EMBEDDING_DIM


class Base(DeclarativeBase):
    type_annotation_map = {dict: JSONB, list: JSONB, uuid.UUID: UUID(as_uuid=True)}


class LinkStatus(str, enum.Enum):
    PENDING = "PENDING"
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    ENRICHING = "ENRICHING"
    INDEXING = "INDEXING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    BLOCKED = "BLOCKED"
    NEEDS_REVIEW = "NEEDS_REVIEW"


TERMINAL_STATUSES = {LinkStatus.COMPLETED, LinkStatus.FAILED, LinkStatus.BLOCKED, LinkStatus.NEEDS_REVIEW}
ACTIVE_STATUSES = {LinkStatus.PENDING, LinkStatus.QUEUED, LinkStatus.PROCESSING, LinkStatus.ENRICHING,
                   LinkStatus.INDEXING}

status_enum = Enum(LinkStatus, name="link_status")


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


def _now() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = _now()


class ApiToken(Base):
    """Opaque bearer tokens: web sessions, browser extension, future iOS app. Only the hash is stored."""

    __tablename__ = "api_tokens"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(20), default="session")  # session | api
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = _now()
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Category(Base):
    """Two-level hierarchy: a top-level group (parent_id NULL) and functional subcategories."""

    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("user_id", "parent_id", "name", postgresql_nulls_not_distinct=True),
    )
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    parent: Mapped["Category | None"] = relationship(remote_side=[id], lazy="joined")


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("user_id", "name"),)
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))


class LinkTag(Base):
    __tablename__ = "link_tags"
    link_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("links.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    source: Mapped[str] = mapped_column(String(10), default="ai")  # ai | user
    tag: Mapped[Tag] = relationship(lazy="joined")


class Link(Base):
    """The knowledge object. Display columns (name, description, ...) hold *effective* values:
    user overrides > AI enrichment > extracted metadata. Raw AI output lives in ai_enrichments."""

    __tablename__ = "links"
    __table_args__ = (
        Index("uq_links_user_url", "user_id", "normalized_url", unique=True,
              postgresql_where=text("deleted_at IS NULL")),
        Index("ix_links_user_created", "user_id", "created_at"),
        Index("ix_links_user_status", "user_id", "status"),
        Index("ix_links_user_domain", "user_id", "domain"),
        Index("ix_links_search_tsv", "search_tsv", postgresql_using="gin"),
        Index("ix_links_embedding", "embedding", postgresql_using="hnsw",
              postgresql_ops={"embedding": "vector_cosine_ops"}),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(Text)  # as submitted
    normalized_url: Mapped[str] = mapped_column(Text)
    final_url: Mapped[str | None] = mapped_column(Text)
    canonical_url: Mapped[str | None] = mapped_column(Text)
    domain: Mapped[str] = mapped_column(String(255))

    status: Mapped[LinkStatus] = mapped_column(status_enum, default=LinkStatus.PENDING)
    status_detail: Mapped[str | None] = mapped_column(Text)  # human-readable reason for FAILED/BLOCKED/...

    # Effective display values
    title: Mapped[str | None] = mapped_column(Text)  # page <title>
    name: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    tldr: Mapped[str | None] = mapped_column(Text)
    content_type: Mapped[str | None] = mapped_column(String(40))
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    has_free_plan: Mapped[bool | None] = mapped_column(Boolean)
    is_open_source: Mapped[bool | None] = mapped_column(Boolean)

    favicon_key: Mapped[str | None] = mapped_column(Text)
    favicon_url: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)  # og:image (remote, not proxied)
    screenshot_key: Mapped[str | None] = mapped_column(Text)
    thumbnail_key: Mapped[str | None] = mapped_column(Text)

    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    overrides: Mapped[dict] = mapped_column(default=dict, server_default=text("'{}'::jsonb"))

    availability: Mapped[str] = mapped_column(String(20), default="unknown")  # unknown|up|down|redirected
    http_status: Mapped[int | None] = mapped_column(Integer)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("links.id", ondelete="SET NULL"))

    search_primary: Mapped[str | None] = mapped_column(Text)
    search_secondary: Mapped[str | None] = mapped_column(Text)
    search_tsv = mapped_column(
        TSVECTOR,
        Computed(
            "setweight(to_tsvector('english', coalesce(search_primary, '')), 'A') || "
            "setweight(to_tsvector('english', coalesce(search_secondary, '')), 'C')",
            persisted=True,
        ),
    )
    embedding = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(120))

    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    category: Mapped[Category | None] = relationship(lazy="joined")
    link_tags: Mapped[list[LinkTag]] = relationship(lazy="selectin", cascade="all, delete-orphan")

    @property
    def tags(self) -> list[str]:
        return sorted(lt.tag.name for lt in self.link_tags)


class ExtractedContent(Base):
    """Append-only: one row per extraction run (version history). Latest row is current."""

    __tablename__ = "extracted_contents"
    id: Mapped[uuid.UUID] = _uuid_pk()
    link_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("links.id", ondelete="CASCADE"), index=True)
    method: Mapped[str] = mapped_column(String(20))  # browser | http | github
    partial: Mapped[bool] = mapped_column(Boolean, default=False)
    http_status: Mapped[int | None] = mapped_column(Integer)
    final_url: Mapped[str | None] = mapped_column(Text)
    canonical_url: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(default=dict)  # description, og:*, keywords, lang, redirects...
    markdown: Mapped[str] = mapped_column(Text, default="")
    text_length: Mapped[int] = mapped_column(Integer, default=0)
    content_hash: Mapped[str] = mapped_column(String(64))
    headings: Mapped[list] = mapped_column(default=list)
    tech_stack: Mapped[list] = mapped_column(default=list)
    github: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _now()


class CodeSnippet(Base):
    __tablename__ = "code_snippets"
    id: Mapped[uuid.UUID] = _uuid_pk()
    link_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("links.id", ondelete="CASCADE"), index=True)
    language: Mapped[str | None] = mapped_column(String(40))
    code: Mapped[str] = mapped_column(Text)
    context: Mapped[str | None] = mapped_column(Text)  # nearest heading above the snippet
    position: Mapped[int] = mapped_column(Integer, default=0)


class AIEnrichment(Base):
    """Append-only AI output (validated JSON). Never edited: user edits go to Link.overrides."""

    __tablename__ = "ai_enrichments"
    id: Mapped[uuid.UUID] = _uuid_pk()
    link_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("links.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(120))
    prompt_version: Mapped[str] = mapped_column(String(40))
    input_hash: Mapped[str] = mapped_column(String(64), index=True)  # response cache key
    data: Mapped[dict] = mapped_column()
    confidence: Mapped[float | None] = mapped_column(Float)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = _now()


class Collection(Base):
    """Manual collection when rules is NULL; otherwise a smart collection evaluated at read time."""

    __tablename__ = "collections"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(40))
    rules: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now())


class CollectionLink(Base):
    __tablename__ = "collection_links"
    collection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True
    )
    link_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("links.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    added_at: Mapped[datetime] = _now()


class IngestionJob(Base):
    """Also the work queue: workers claim rows with FOR UPDATE SKIP LOCKED."""

    __tablename__ = "ingestion_jobs"
    __table_args__ = (Index("ix_jobs_queue", "status", "run_after"),)
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    link_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("links.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="ingest")  # ingest | reprocess | health
    status: Mapped[LinkStatus] = mapped_column(status_enum, default=LinkStatus.QUEUED)
    resume_from: Mapped[str] = mapped_column(String(20), default="extract")  # extract | enrich | index
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    run_after: Mapped[datetime] = _now()
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str | None] = mapped_column(String(80))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _now()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProcessingLog(Base):
    __tablename__ = "processing_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    link_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("links.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ingestion_jobs.id", ondelete="SET NULL"))
    stage: Mapped[str] = mapped_column(String(20))
    level: Mapped[str] = mapped_column(String(10), default="info")
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _now()


class AvailabilityCheck(Base):
    __tablename__ = "availability_checks"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    link_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("links.id", ondelete="CASCADE"), index=True)
    ok: Mapped[bool] = mapped_column(Boolean)
    http_status: Mapped[int | None] = mapped_column(Integer)
    final_url: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    checked_at: Mapped[datetime] = _now()


class SearchHistory(Base):
    __tablename__ = "search_history"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    query: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(String(20))
    result_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = _now()
