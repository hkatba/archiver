# Project status

_Last updated: 2026-11-25_

The MVP (roadmap phases 1–5 plus parts of 6–7) is implemented, tested, and running locally end to end:
URLs pasted in the web app are rendered in Chromium, archived, analyzed by a local LLM (Ollama), indexed, and found
again through natural-language search and the assistant.

## Verified

- **Backend tests: 95 passing** (`cd backend && uv run pytest`): URL normalization and extraction from text,
  SSRF guard (IP classes, hostnames, egress proxy), password hashing, HTML extraction on 5 fixture site types,
  block/challenge detection, GitHub parsing, AI schema coercion and evidence verification, the full pipeline
  (success, LLM path + response cache, retry → dead letter, blocked, resume-from-enrich, needs-review), the API
  (auth, tokens, isolation between users, dedup, overrides survive re-analysis, trash/restore, filters, search,
  collections, merge, stats, snippets, assistant, export/import round trip), and two real-Chromium tests (render
  through the egress proxy; redirect to `169.254.169.254` blocked).
- **Frontend**: `eslint`, `tsc` and `next build` clean.
- **Live run** (this machine): 10 real sites added via the UI (GitHub repo, SaaS landing pages, a JS app, docs,
  PDF tools) → all `COMPLETED` with screenshots, GitHub stats, local AI analysis (Ollama `mistral` 7B on GPU),
  correct categories; search "I need to make slides for a pitch" → Gamma first.
- **Docker**: all three images build; API container migrates and serves; Chromium launches in the worker image.

## Completed

- Phase 1 (foundation): repo structure, FastAPI + Next.js 16, Postgres 17 + pgvector, Alembic migration, auth
  (accounts, sessions, API tokens), dashboard, URL submission (single/bulk/file/drag-drop/clipboard + preview),
  normalization, tracking-param stripping, dedup, canonical-duplicate detection.
- Phase 2 (extraction): Playwright rendering via SSRF egress proxy, HTTP fallback, robots.txt, per-domain politeness,
  screenshots + thumbnails, favicons, OG/JSON-LD metadata, Markdown, headings, code snippets, tech detection,
  GitHub API, challenge/CAPTCHA detection (never bypassed), job tracking with statuses and logs.
- Phase 3 (AI): provider abstraction (Anthropic, OpenAI, Gemini, Ollama, OpenAI-compatible), extractive fallback,
  strict schema + shape coercion for small models, evidence verification, pricing discard rule, response cache,
  token accounting.
- Phase 4 (search): local embeddings, hybrid search with RRF and explanations, filters, manual + smart
  collections, related links.
- Phase 5 (UX): overview with the "cairn" category chart, grid/list views, link detail, reader view, notes, user
  edits with precedence, Markdown download, dark/light themes, responsive layout.
- From phase 6: GitHub intelligence, code snippets page, availability checks (manual + periodic), AI assistant,
  smart collections, collection suggestions, duplicate merge.
- From phase 7: JSON export/restore, Obsidian/Logseq Markdown export, Dockerfiles + compose, CI workflow, docs.
- Design pass (2026-11-25): editorial "field survey" art direction. Instrument Serif titles paired with Instrument
  Sans, Newsreader for reading; limestone/basalt palette with one lichen accent; paper grain; a WebGL2 contour map
  (`components/terrain.tsx`) that bends round the cursor on sign-in and the overview masthead; spring-settling cairn
  chart; sliding nav marker; route transitions via React `<ViewTransition>`; CSS scroll-driven reading progress and
  link-title bar; full-screen mobile menu; reduced-motion respected everywhere.
- Motion pass (2026-11-25): GSAP + ScrollTrigger + SplitText (`lib/gsap.ts`) and Three.js (lazy chunk). Overview: a
  3D cairn built from the category counts (`components/cairn-3d.tsx`: spring drop-in, cursor lean, click a stone to
  filter) held sticky beside a scroll story that lifts the stones apart and lights the category being read; count-up
  ledger; pinned horizontal "Recently added" strip; scroll-driven tag drift. All links: category rail, sticky
  toolbar, featured lead card, batch scroll reveals with image wipes, cursor "Open" chip. All motion sits behind
  `prefers-reduced-motion: no-preference`.

## Pending (prioritized)

1. **Browser extension** (Chrome MV3: save page/selection/tabs, "already saved" badge, progress). API is ready:
   `POST /api/links`, `/bulk`, `GET /api/links/lookup`, bearer tokens.
2. **Price watch**: `price_snapshots` table, periodic re-extraction of pricing pages, change detection, alerts.
3. **Content-change detection** in health checks (compare content hashes; currently availability only).
4. **S3-compatible storage** adapter (`app/storage.py` has the interface; local filesystem only today).
5. **Notion export** integration (Markdown export exists; Notion API not yet).
6. Frontend component/E2E tests (Playwright test runner) — today the UI is verified by lint/types/build and manual runs.
7. Offline-first PWA (service worker) so archived pages open without connectivity to the server; the reader view
   already works when the original site is gone.
8. Larger embedding model option (needs a migration for the vector dimension); reranking.
9. Browser extension sessions UI, iOS share-sheet app (API contracts are ready).

## Known issues / limitations

- Links processed by the non-Docker worker in session 1 have screenshots/thumbnails on the host filesystem, not in
  the Docker volume, so the Docker API returns 404 for them. The UI now falls back to a category tile; re-reading
  those links ("Re-read the page") regenerates the files.

- **Local LLM speed**: with Ollama `mistral` 7B on an 8 GB GPU each link takes ~30–100 s to analyze; 100 links ≈
  1–2 hours in the background. Claude Haiku (`AI_PROVIDER=anthropic`) is much faster. `phi4` is larger than 8 GB
  VRAM (~2 min per assistant answer), so the local `.env` uses mistral for the assistant too.
- **Local LLM accuracy**: a 7B model sometimes miscategorizes (e.g. FastAPI filed under "AI Tools"). The prompt
  restricts "AI Tools" to products whose core job is AI; a stronger model (Claude/GPT/Gemini) does better, and any
  category can be corrected on the link (user edits always win).
- Ollama's default context window can truncate long prompts; `AI_MAX_INPUT_CHARS=6000` is set locally for that.
- Rate limiting is in-process (fine for one API process; move to Postgres/Redis for several replicas).
- Tech detection uses ~30 signatures, not the full Wappalyzer set.
- Domain grouping strips only `www.` (no public-suffix list).
- The small embedding model (bge-small, 384-d) is good but not perfect at loose paraphrases.
- API/worker image is ~4.3 GB (Chromium + system libraries); could be slimmed with a multi-stage build.
- robots.txt is respected by default; some sites disallow all bots, so their links end up `BLOCKED` with an
  explanation. `RESPECT_ROBOTS_TXT=false` overrides it for personal use.

## Technical decisions

See [ARCHITECTURE.md](ARCHITECTURE.md#decisions). Highlights: Postgres doubles as the job queue (no Redis/Celery);
pgvector in the same DB; local embeddings; two LLM adapters cover five provider families; all browser traffic goes
through an SSRF-checking proxy; user edits stored separately and always win.

## Next recommended tasks

1. Load your real 100+ URLs (Add links → paste or drop a file), and pick the AI provider you want for quality/speed.
2. Build the Chrome extension against the existing API.
3. Price watch + content-change detection on the existing worker maintenance loop.
4. Frontend E2E tests (Playwright) covering add → process → search → detail.
