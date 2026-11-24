# Architecture

```
 Browser (Next.js app)                Browser extension / iOS app / scripts
        │  same-origin /api/* (session cookie)        │  Authorization: Bearer <token>
        ▼                                             ▼
 ┌──────────────┐   rewrite /api/*   ┌──────────────────────────────┐
 │ Next.js 16   │ ─────────────────▶ │ FastAPI  (app.main)          │
 │ frontend/    │                    │  auth, links, search, ...    │
 └──────────────┘                    └──────────────┬───────────────┘
                                                    │ SQL
                         ┌──────────────────────────▼──────────────────────────┐
                         │ PostgreSQL 17 + pgvector                             │
                         │  data, full-text (tsvector), vectors (HNSW), queue   │
                         └──────────────────────────▲──────────────────────────┘
                                                    │ FOR UPDATE SKIP LOCKED
                                       ┌────────────┴────────────┐
                                       │ Worker (app.worker)     │──▶ Chromium (Playwright)
                                       │ extract → enrich → index│      └─ via SSRF egress proxy
                                       └────────────┬────────────┘──▶ LLM provider (optional)
                                                    ▼                ──▶ GitHub API
                                           storage/ (screenshots, thumbnails, favicons)
```

Three processes, one database. The API and worker are the same Python package with two entry points.

## Decisions

| Decision | Why |
|---|---|
| FastAPI (Python) backend, Next.js frontend | Python has the strongest extraction/AI ecosystem (Trafilatura, Playwright, fastembed); FastAPI generates the OpenAPI contract the extension and iOS app use. |
| Postgres as the job queue (no Redis/Celery) | `ingestion_jobs` rows are claimed with `FOR UPDATE SKIP LOCKED`: transactional with the data, safe with many workers, retries/backoff via `run_after`, one less service to run. Revisit only if throughput needs exceed thousands of jobs/minute. |
| pgvector in the same database | Hybrid search is one SQL round trip per mode with the same filters; no sync between stores. HNSW index on `links.embedding`. |
| Local embeddings (fastembed, `bge-small-en-v1.5`, 384-d) | Works with no API key and no per-query cost; CPU-fast. The dimension is fixed in the schema (`EMBEDDING_DIM`); changing model size needs a migration and a re-embed. |
| LLM provider abstraction with two adapters | `anthropic_provider` (official SDK, structured outputs) and `openai_provider` (any OpenAI-compatible API: OpenAI, Gemini, Ollama, vLLM). Core code only sees `LLMProvider.structured()` / `.chat()`. |
| Opaque bearer tokens, hashed at rest | One mechanism for web sessions (httpOnly SameSite=Lax cookie), extension, scripts and iOS; revocable per device. Passwords use stdlib scrypt. |
| Next.js proxies `/api/*` | Cookies stay first-party, no CORS, no API URL or secret in the browser bundle. |
| Effective-value columns on `links` | Display fields (`name`, `description`, `category_id`, ...) are recomputed as *user override > AI > page metadata*. Raw AI output is append-only in `ai_enrichments`; user edits live in `links.overrides`, so re-analysis never overwrites them. |

## Ingestion pipeline (`app/pipeline.py`)

1. **Submit** (`POST /api/links`, `/bulk`): `urls.normalize_url()` lowercases scheme/host, IDNA-encodes,
   drops default ports, fragments (except SPA `#/` routes), trailing slashes and known tracking params
   (`utm_*`, `fbclid`, `gclid`, ...; meaningful params such as `ref` or `v` are kept), sorts the query. That is the
   per-user dedup key (unique index). A `links` row (`QUEUED`) and an `ingestion_jobs` row are created.
2. **Extract** (`PROCESSING`, `app/extract.py`): robots.txt check (configurable) → per-domain politeness delay →
   Chromium render in a fresh context (network-idle wait, cookie-banner CSS, full-page screenshot capped at
   6000px) → if the browser fails or hits a challenge, a plain SSRF-safe HTTP fetch. Trafilatura converts the main
   content to Markdown (falls back to rendered `innerText` for JS apps). BeautifulSoup collects metadata, JSON-LD,
   headings, code snippets; ~30 signatures detect the tech stack. GitHub repos are augmented through the GitHub
   API (README becomes the archived Markdown). Screenshots are re-encoded (JPEG + 640×400 WebP thumbnail);
   favicons are re-encoded to PNG so third-party bytes are never served from our origin.
   After saving, the canonical/final URL is checked against other links to flag duplicates.
3. **Enrich** (`ENRICHING`, `app/enrich.py`): the prompt contains only the page's metadata and content
   (capped by `AI_MAX_INPUT_CHARS`). The model must return the `Enrichment` schema. `verify()` checks every
   evidence quote against the source text: unverified features are marked "inferred", unverified pricing is
   discarded, prices whose digits aren't on the page are dropped, alternatives are always "unverified". Results are
   cached by `sha256(prompt_version, provider, model, prompt)`. With no provider configured,
   `extractive_enrichment()` uses page metadata and zero-shot category matching by embedding similarity.
4. **Index** (`INDEXING`): effective values are recomputed, the search document (`search_primary` weight A,
   `search_secondary` weight C → generated `tsvector`) is refreshed, and the embedding is computed.
5. **Finish**: `COMPLETED`, or `NEEDS_REVIEW` when very little content was found.

**Failures**: `Blocked` (robots.txt, CAPTCHA/Cloudflare challenge, 401/403), `UnsafeURL` (non-public address) and
`PermanentError` (404/410, non-HTML) are final. Everything else (timeouts, 5xx, 429, LLM errors) is retried
at 30s, 2m, 8m (`MAX_ATTEMPTS`), resuming at the stage that failed, then dead-lettered as `FAILED` with the
reason. If a re-extraction fails but an archived copy exists, the link stays readable (`NEEDS_REVIEW`,
availability `down`). Every stage writes `processing_logs` rows shown on the link page. Jobs whose worker died
are requeued after 15 minutes without a heartbeat.

**Health checks**: the worker re-checks links older than `HEALTH_CHECK_DAYS` with a lightweight HTTP GET
(no browser), recording `availability_checks` history and `links.availability`.

## Search (`app/search.py`)

- Semantic: cosine distance on `links.embedding` (HNSW), results under `min_similarity` dropped.
- Keyword: `hybrid` mode ORs all query lexemes (ranked by `ts_rank_cd` coverage); `keyword` mode uses
  `websearch_to_tsquery` (AND, quotes, `-exclusions`).
- Fusion: Reciprocal Rank Fusion (k=60). Both modes apply the same filters (category/subcategory, tags, domain,
  collection, status, favorite, free plan, open source, content type, availability, dates).
- Explanations: semantic strength + matched lexemes + category/tag hits.
- Smart collections store rules (filters + optional natural-language query) and are evaluated at read time, so
  they always include newly saved links.
- The assistant retrieves the top 8 matches for the last two user turns and answers with the smart model under a
  system prompt that forbids inventing library items; cited `[n]` items are returned as sources.

## Security model

- **SSRF**: every server-side fetch resolves the host, rejects any non-global address (private, loopback,
  link-local incl. `169.254.169.254`, CGNAT, IPv4-mapped/6to4/Teredo-embedded, multicast, `.internal`/`.local`
  names), then connects to the *checked IP* with the original Host header and TLS SNI (no DNS-rebinding window).
  Redirects are followed manually and re-checked per hop.
- **Browser SSRF**: Playwright's `page.route()` does not see redirect hops, so Chromium is launched with all
  traffic forced through an in-process egress proxy (`netguard.EgressProxy`, loopback bypass disabled, QUIC off)
  that applies the same resolve-check-pin rule to every request, including redirects and subresources. Covered by
  a real-Chromium test that redirects to the metadata IP.
- **Untrusted content**: Markdown is rendered without raw HTML, links get `rel="noopener noreferrer nofollow"`,
  remote images are shown as links. Stored images are re-encoded; SVG is never served. Files are only served
  through ownership-checked endpoints with `nosniff`.
- **Isolation**: every query is scoped by `user_id`; other users' IDs return 404. Tested.
- **Auth**: scrypt password hashes; tokens are 256-bit random, stored as SHA-256; cookies httpOnly + SameSite=Lax
  (+ Secure via `COOKIE_SECURE`). Login/register, ingestion and assistant are rate limited (in-process).
- **Production egress**: run the worker on a network that also blocks private ranges at the firewall level as
  defense in depth.

## Repository layout

```
backend/   FastAPI app (app/), Alembic migrations, tests (fixtures/), Dockerfile
frontend/  Next.js 16 app router: src/app routes, src/components (pages/, ui/ from shadcn), src/lib
seed/      sample URLs
docker-compose.yml, .env.example, .github/workflows/ci.yml
```
