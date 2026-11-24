FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    FASTEMBED_CACHE_DIR=/data/models \
    STORAGE_DIR=/data/storage

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
# Chromium + its system libraries for the extraction worker (Playwright's node driver needs libatomic)
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/* \
    && uv run --no-sync playwright install --with-deps chromium

COPY . .
RUN useradd --create-home --uid 1000 cairn \
    && mkdir -p /data/storage /data/models \
    && chown -R cairn /data /ms-playwright
USER cairn
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
