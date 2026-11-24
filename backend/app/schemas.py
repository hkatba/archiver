"""API request/response models. These are the public contract (web app, browser extension, future iOS app)."""

import re
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.models import LinkStatus

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Credentials(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(min_length=8, max_length=200)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL.match(v):
            raise ValueError("Invalid email address")
        return v


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    created_at: datetime


class AuthOut(BaseModel):
    user: UserOut
    token: str


class TokenIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class TokenOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: str
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None


class TokenCreated(TokenOut):
    token: str = Field(description="Shown once. Use as `Authorization: Bearer <token>`.")


# ---------------------------------------------------------------- links


class PreviewIn(BaseModel):
    text: str = Field(max_length=2_000_000, description="Pasted URLs, TXT/CSV contents or a bookmarks HTML export")


class PreviewItemOut(BaseModel):
    input: str
    normalized_url: str | None
    valid: bool
    error: str | None
    duplicate_of: uuid.UUID | None
    duplicate_in_batch: bool


class PreviewOut(BaseModel):
    items: list[PreviewItemOut]
    total: int
    new: int
    duplicates: int
    invalid: int


class LinkIn(BaseModel):
    url: str = Field(max_length=4096)
    collection_id: uuid.UUID | None = None
    notes: str | None = Field(None, max_length=20_000)


class BulkIn(BaseModel):
    urls: list[str] = Field(max_length=1000)
    collection_id: uuid.UUID | None = None


class LinkCard(BaseModel):
    id: uuid.UUID
    url: str
    normalized_url: str
    domain: str
    name: str | None
    title: str | None
    description: str | None
    category: str | None
    subcategory: str | None
    tags: list[str]
    content_type: str | None
    status: LinkStatus
    status_detail: str | None
    is_favorite: bool
    availability: str
    has_free_plan: bool | None
    is_open_source: bool | None
    favicon: str | None
    thumbnail: str | None
    duplicate_of_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    github: dict | None = None


class BulkOut(BaseModel):
    created: list[LinkCard]
    duplicates: list[PreviewItemOut]
    invalid: list[PreviewItemOut]


class LinkList(BaseModel):
    items: list[LinkCard]
    total: int


class Snippet(BaseModel):
    id: uuid.UUID
    link_id: uuid.UUID
    language: str | None
    code: str
    context: str | None
    link_name: str | None = None


class LogEntry(BaseModel):
    stage: str
    level: str
    message: str
    data: dict | None
    created_at: datetime


class CollectionRef(BaseModel):
    id: uuid.UUID
    name: str


class LinkDetail(LinkCard):
    tldr: str | None
    final_url: str | None
    canonical_url: str | None
    screenshot: str | None
    image_url: str | None
    notes: str | None
    overrides: dict
    http_status: int | None
    last_checked_at: datetime | None
    last_processed_at: datetime | None
    ai: dict | None = Field(description="Latest AI enrichment: {provider, model, created_at, data}")
    extraction: dict | None
    markdown: str | None
    snippets: list[Snippet]
    collections: list[CollectionRef]
    logs: list[LogEntry]
    last_error: str | None


class LinkPatch(BaseModel):
    """User edits. Any field set here overrides the AI value permanently (until cleared with null)."""

    name: str | None = Field(None, max_length=300)
    description: str | None = Field(None, max_length=5000)
    tldr: str | None = Field(None, max_length=5000)
    category: str | None = Field(None, max_length=120)
    subcategory: str | None = Field(None, max_length=120)
    tags: list[str] | None = Field(None, max_length=30)
    content_type: str | None = Field(None, max_length=40)
    free_plan: bool | None = None
    open_source: bool | None = None
    notes: str | None = Field(None, max_length=20_000)
    is_favorite: bool | None = None


class MergeIn(BaseModel):
    into_id: uuid.UUID


# ---------------------------------------------------------------- search


class SearchFilters(BaseModel):
    category: str | None = None
    subcategory: str | None = None
    tags: list[str] = []
    domain: str | None = None
    collection_id: uuid.UUID | None = None
    status: LinkStatus | None = None
    favorite: bool | None = None
    free_plan: bool | None = None
    open_source: bool | None = None
    content_type: str | None = None
    availability: str | None = None
    created_after: datetime | None = None
    created_before: datetime | None = None


class SearchIn(BaseModel):
    query: str = Field("", max_length=500)
    mode: Literal["hybrid", "semantic", "keyword"] = "hybrid"
    filters: SearchFilters = SearchFilters()
    limit: int = Field(20, ge=1, le=100)


class SearchResult(BaseModel):
    link: LinkCard
    score: float
    similarity: float | None
    reasons: list[str]


class SearchOut(BaseModel):
    query: str
    mode: str
    results: list[SearchResult]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class AssistantIn(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)
    filters: SearchFilters = SearchFilters()


class AssistantOut(BaseModel):
    answer: str
    sources: list[LinkCard]
    provider: str
    model: str


# ---------------------------------------------------------------- collections


class SmartRules(BaseModel):
    query: str | None = Field(None, max_length=300, description="Natural-language semantic match")
    category: str | None = None
    subcategory: str | None = None
    tags: list[str] = []
    domain: str | None = None
    free_plan: bool | None = None
    open_source: bool | None = None
    content_type: str | None = None


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)
    icon: str | None = Field(None, max_length=40)
    rules: SmartRules | None = None


class CollectionPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)
    icon: str | None = Field(None, max_length=40)
    rules: SmartRules | None = None


class CollectionOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    icon: str | None
    rules: dict | None
    is_smart: bool
    link_count: int
    created_at: datetime


class CollectionLinksIn(BaseModel):
    link_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class Facet(BaseModel):
    name: str
    count: int
    children: list["Facet"] = []


class Stats(BaseModel):
    total: int
    completed: int
    in_progress: int
    failed: int
    blocked: int
    needs_review: int
    favorites: int
    by_status: dict[str, int]
    categories: list[Facet]
    top_tags: list[Facet]
    recent: list[LinkCard]
    recently_accessed: list[LinkCard]
    suggestions: list[dict[str, Any]]
    ai: dict
    tokens: dict
