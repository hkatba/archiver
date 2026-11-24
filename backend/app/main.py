import logging

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.api import auth, discover, library, links
from app.config import APP_NAME

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title=f"{APP_NAME} API",
    version="0.1.0",
    description="Save anything. Understand everything. Find it instantly.\n\n"
                "Authenticate with the session cookie (web app) or `Authorization: Bearer <token>` "
                "(create tokens at `POST /api/tokens`).",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)

for r in (auth.router, links.router, library.router, discover.router):
    app.include_router(r)


@app.get("/api/health", tags=["system"])
def health():
    return {"status": "ok"}


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


@app.exception_handler(ValueError)
async def value_error(_, exc: ValueError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})
