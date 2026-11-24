# API documentation

Interactive OpenAPI docs: **`http://127.0.0.1:8000/api/docs`** (machine-readable: `/api/openapi.json`).
All endpoints are under `/api`, take and return JSON, and require authentication unless noted.

## Authentication

- Web app: `POST /api/auth/login` sets an httpOnly `cairn_session` cookie.
- Extension, iOS app, scripts: create a token (`POST /api/tokens` or Settings → API tokens) and send
  `Authorization: Bearer <token>`.

```bash
TOKEN=cairn_xxx
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"url":"https://excalidraw.com"}' http://127.0.0.1:8000/api/links
```

Errors use `{"detail": "human-readable reason"}` with standard status codes: 401 unauthenticated,
404 not found (also for other users' objects), 409 conflict (duplicate / already processing), 422 validation,
429 rate limited, 502 AI provider failure.

## Endpoints

### Auth and tokens
| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | `{email, password}` → `{user, token}` + session cookie (if `ALLOW_REGISTRATION`) |
| POST | `/auth/login` | `{email, password}` → `{user, token}` + session cookie |
| POST | `/auth/logout` | Revokes the current token |
| GET | `/auth/me` | Current user |
| GET / POST | `/tokens` | List / create API tokens (`{name}` → token shown once) |
| DELETE | `/tokens/{id}` | Revoke a token |

### Links
| Method | Path | Description |
|---|---|---|
| POST | `/links/preview` | `{text}` (pasted URLs, TXT/CSV, bookmarks HTML) → per-URL normalized form, validity, duplicate info |
| POST | `/links` | `{url, collection_id?, notes?}` → 201 link card, or 409 `{detail, link}` if already saved |
| POST | `/links/bulk` | `{urls[], collection_id?}` (≤1000) → `{created[], duplicates[], invalid[]}` |
| GET | `/links` | List with filters: `q, category, subcategory, tag (repeat), domain, collection_id, status, favorite, free_plan, open_source, availability, duplicates, deleted, sort (created_desc, created_asc, name, accessed, updated), limit, offset` → `{items, total}` |
| GET | `/links/lookup?url=` | Already saved? (browser extension) → link card or `null` |
| POST | `/links/retry-failed` | Requeue every FAILED link |
| GET | `/links/{id}` | Full knowledge object: effective fields, `ai` (raw enrichment with evidence/verification), `extraction` metadata, `markdown`, `snippets`, `collections`, `logs`, `overrides` |
| PATCH | `/links/{id}` | User edits: `name, description, tldr, category, subcategory, tags, content_type, free_plan, open_source` (override AI; `null` clears the override), `notes`, `is_favorite` |
| DELETE | `/links/{id}` | Move to trash (soft delete) |
| POST | `/links/{id}/restore` | Restore from trash |
| POST | `/links/{id}/retry` | Retry from the stage that failed |
| POST | `/links/{id}/reprocess` | Re-extract and re-analyze |
| POST | `/links/{id}/regenerate` | Re-run AI analysis only |
| POST | `/links/{id}/check` | Check availability now |
| GET | `/links/{id}/related` | Similar links in the library `[{link, similarity}]` |
| POST | `/links/{id}/merge` | `{into_id}`: merge into another link, keeping notes, tags, collections, favorite |
| GET | `/links/{id}/markdown` | Download as Markdown (YAML front matter) |
| GET | `/links/{id}/screenshot`, `/thumbnail`, `/favicon` | Stored images |

Link `status`: `PENDING, QUEUED, PROCESSING, ENRICHING, INDEXING, COMPLETED, FAILED, BLOCKED, NEEDS_REVIEW`;
`status_detail` explains failures in plain language.

### Search and assistant
| Method | Path | Description |
|---|---|---|
| POST | `/search` | `{query, mode: hybrid|semantic|keyword, filters: {category, subcategory, tags[], domain, collection_id, status, favorite, free_plan, open_source, content_type, availability, created_after, created_before}, limit}` → `{results: [{link, score, similarity, reasons[]}]}` |
| POST | `/assistant` | `{messages: [{role, content}], filters}` → `{answer, sources[], provider, model}`; 400 when no AI provider is configured |

### Library
| Method | Path | Description |
|---|---|---|
| GET / POST | `/collections` | List / create. Smart collection: `rules: {query?, category?, subcategory?, tags[], domain?, free_plan?, open_source?, content_type?}` |
| GET / PATCH / DELETE | `/collections/{id}` | |
| GET | `/collections/{id}/links` | Links (smart collections evaluated live) |
| POST | `/collections/{id}/links` | `{link_ids[]}` (manual collections only) |
| DELETE | `/collections/{id}/links/{link_id}` | |
| GET | `/categories` | Category tree with counts |
| GET | `/tags` | Tags with counts |
| GET | `/domains` | Domains with counts |
| GET | `/snippets` | Code snippets: `q, language, limit, offset` |
| GET | `/stats` | Dashboard: counts by status, category tree, top tags, recent, suggestions, AI status, token usage |
| GET | `/system/status` | AI provider, embeddings, browser, queue |
| GET | `/export?format=json|markdown` | Full JSON backup, or ZIP of Markdown notes (Obsidian/Logseq) |
| POST | `/import` | Restore a JSON backup (skips URLs already saved; re-embeds locally) |
| GET | `/health` | Liveness (no auth) |

## Notes for the browser extension and iOS app

- Use bearer tokens; one token per device so they can be revoked individually.
- Save the current page: `POST /links {url}` → 201 or 409 with the existing link.
- Show "already saved": `GET /links/lookup?url=`.
- Save selected text: `POST /links {url, notes: "<selection>"}`.
- Save many tabs: `POST /links/bulk {urls}`.
- Poll `GET /links/{id}` while `status` is one of the active states to show progress.
- Offline reading: `GET /links/{id}` includes the archived `markdown`; cache it on device.
