# Cairn

**Save anything. Understand everything. Find it instantly.**

Cairn turns a pile of saved URLs into a searchable library of knowledge objects. Paste 100 links; each one is
opened in a real browser, screenshotted, archived as Markdown, analyzed (what it does, problems it solves,
who it's for, features, pricing *only when the page shows it*), categorized, tagged and indexed for search by meaning.
Then ask for what you need in plain language: "a tool to turn text into videos".

> A cairn is a stack of stones that marks a trail, so you can find your way back.

## What works today

- Add links one at a time, in bulk (paste), or from TXT / CSV / browser bookmark exports (drag and drop), with an
  import preview that normalizes URLs, strips tracking parameters and flags duplicates before anything is saved.
- Ingestion pipeline with visible status per link (`QUEUED → PROCESSING → ENRICHING → INDEXING → COMPLETED`, plus
  `FAILED`, `BLOCKED`, `NEEDS_REVIEW`), retries with backoff, resume-from-failed-stage, and readable failure reasons.
- Extraction: headless Chromium (Playwright) → HTTP fallback; screenshots and thumbnails, favicon, OpenGraph and
  JSON-LD metadata, canonical URL, redirects, clean Markdown, headings, code snippets, technology detection,
  GitHub API data (stars, forks, license, languages, latest release, README) for repositories.
- AI enrichment through a provider-neutral layer: Anthropic Claude, OpenAI, Gemini, Ollama (local) or any
  OpenAI-compatible server. Strict schema, verbatim evidence quotes checked against the page, unverified pricing
  discarded, alternatives labelled as unverified. Without any provider, a metadata-only profile is built.
- Hybrid search (pgvector + Postgres full-text, Reciprocal Rank Fusion) with "why this matched" explanations,
  filters, and an assistant that answers from your saved links only, with citations.
- Collections (manual and smart/rule-based, auto-updating), categories, tags, favorites, code snippets,
  GitHub repos, related links, duplicate detection and merge, personal notes, user edits that override AI values.
- Offline reader for archived content, Markdown download, JSON backup + restore, Obsidian/Logseq Markdown export.
- Accounts, API tokens (for the browser extension, scripts and the future iOS app), per-user data isolation,
  SSRF protection that also covers the browser, rate limits. Light and dark themes.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for what is done, what is next, and known limitations.

## Quick start (local development)

Requirements: Docker, Python 3.12 with [uv](https://docs.astral.sh/uv/), Node 20+.

```bash
cp .env.example .env              # adjust AI_PROVIDER etc. (works without any API key)
docker compose up -d db           # Postgres 17 + pgvector on 127.0.0.1:5433

cd backend
uv sync
uv run playwright install chromium
uv run alembic upgrade head
uv run uvicorn app.main:app --port 8000      # API  -> http://127.0.0.1:8000/api/docs
uv run python -m app.worker                  # worker (second terminal)

cd ../frontend
npm install
npm run dev                                   # app  -> http://localhost:3000
```

Create an account on the sign-in page, then **Add links**. To load ~35 sample sites into a demo account:

```bash
cd backend
uv run python -m app.seed --email demo@cairn.test --password cairn-demo-2026 --file ../seed/sample_urls.txt
```

## Run everything in Docker

```bash
cp .env.example .env
docker compose --profile app up --build        # web on :3000, API on :8000, worker, Postgres
```

To use Ollama running on the host from Docker, keep `AI_PROVIDER=ollama`; the compose file points the containers
at `host.docker.internal:11434`.

## Choosing an AI provider

| `AI_PROVIDER` | Needs | Default models (fast / assistant) |
|---|---|---|
| `extractive` (default) | nothing | none: summaries come from the page's own metadata |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-haiku-5-5` / `claude-opus-5-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-5-mini` / `gpt-5` |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` / `gemini-2.5-pro` |
| `ollama` | Ollama running locally | `mistral:7b-instruct-v0.3-q5_0` / `phi4:latest` |
| `openai_compatible` | `OPENAI_BASE_URL` (+ key) | set `AI_MODEL_FAST` / `AI_MODEL_SMART` |

Override models with `AI_MODEL_FAST` and `AI_MODEL_SMART`. The fast model analyzes each link; the smart model
answers assistant questions. Identical page content is never analyzed twice (response cache by content hash).
Semantic search embeddings always run locally (`fastembed`, `BAAI/bge-small-en-v1.5`), so search costs nothing.

## Tests

```bash
cd backend && uv run pytest            # 95 tests: unit, API, pipeline, security, real-Chromium integration
cd frontend && npx eslint src && npm run build   # build includes the TypeScript check
```

Tests use a separate `cairn_test` database (`TEST_DATABASE_URL`), local HTML fixtures and a deterministic
embedder, so they never depend on live websites or API keys.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): components, pipeline, search, security model, decisions
- [API_DOCUMENTATION.md](API_DOCUMENTATION.md): REST API (interactive docs at `/api/docs`)
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md): tables and indexes
- [PROJECT_STATUS.md](PROJECT_STATUS.md): progress, known issues, next steps
