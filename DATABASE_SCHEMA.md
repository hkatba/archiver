# Database schema

PostgreSQL 17 with the `vector` extension. Models: `backend/app/models.py`; migrations: `backend/alembic/versions/`
(`uv run alembic upgrade head`). All primary keys are UUIDs except log/history tables (bigserial).

## Entities

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Accounts | `email` (unique), `password_hash` (scrypt) |
| `api_tokens` | Sessions and API tokens (web, extension, iOS) | `token_hash` (sha256, unique), `kind` (session/api), `expires_at`, `last_used_at` |
| `links` | **The knowledge object** | see below |
| `extracted_contents` | Append-only extraction runs (version history; latest = current) | `method` (browser/http/github), `partial`, `meta` (description, OG, JSON-LD, keywords, redirects, notes), `markdown`, `content_hash`, `headings`, `tech_stack`, `github` |
| `ai_enrichments` | Append-only AI output, never edited | `provider`, `model`, `prompt_version`, `input_hash` (response cache key), `data` (validated + verified JSON), `confidence`, `tokens_in/out` |
| `categories` | Two-level hierarchy per user | `parent_id` (NULL = top level), unique `(user_id, parent_id, name)` NULLS NOT DISTINCT |
| `tags`, `link_tags` | Tags; `link_tags.source` = `ai` or `user` | unique `(user_id, name)` |
| `collections`, `collection_links` | Manual collections; smart ones have `rules` (JSONB) and no membership rows | |
| `code_snippets` | Code found on pages | `language`, `code`, `context` (nearest heading) |
| `ingestion_jobs` | Processing jobs **and the work queue** | `status`, `resume_from` (extract/enrich/index), `attempts`, `max_attempts`, `run_after`, `locked_at/by`, `last_error` |
| `processing_logs` | Structured per-stage logs shown to the user | `stage`, `level`, `message`, `data` |
| `availability_checks` | Health-check history | `ok`, `http_status`, `final_url`, `error` |
| `search_history` | Queries (for future suggestions) | `query`, `mode`, `result_count` |

### `links`

| Group | Columns |
|---|---|
| Identity | `id`, `user_id`, `url` (as entered), `normalized_url` (dedup key), `final_url`, `canonical_url`, `domain` |
| Pipeline | `status` (`link_status` enum), `status_detail`, `last_processed_at`, `duplicate_of_id` |
| Effective values (user override > AI > metadata) | `name`, `title`, `description`, `tldr`, `content_type`, `category_id`, `has_free_plan`, `is_open_source` |
| User data | `is_favorite`, `notes`, `overrides` (JSONB of user edits), `last_accessed_at` |
| Media | `screenshot_key`, `thumbnail_key`, `favicon_key` (storage keys), `favicon_url`, `image_url` |
| Health | `availability` (unknown/up/down/redirected), `http_status`, `last_checked_at` |
| Search | `search_primary`, `search_secondary`, `search_tsv` (generated: weight A + C), `embedding vector(384)`, `embedding_model` |
| Lifecycle | `created_at`, `updated_at`, `deleted_at` (soft delete) |

### Indexes

- `uq_links_user_url`: unique `(user_id, normalized_url) WHERE deleted_at IS NULL`
- `ix_links_search_tsv`: GIN on `search_tsv`
- `ix_links_embedding`: HNSW `vector_cosine_ops` on `embedding`
- `(user_id, created_at)`, `(user_id, status)`, `(user_id, domain)`, `category_id`
- `ix_jobs_queue`: `(status, run_after)` for the queue claim
- Foreign-key indexes on all child tables

## Not yet modeled (planned)

`price_snapshots` (price monitoring), `related_links` (precomputed relations; currently computed on demand by
vector similarity), a `domains` table for per-domain caching. See PROJECT_STATUS.md.
