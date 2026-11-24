import os
import tempfile
from pathlib import Path

# Configure before any app import: settings are read at import time.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://cairn:cairn@127.0.0.1:5433/cairn_test")
os.environ.update(
    EMBEDDING_PROVIDER="hash", AI_PROVIDER="extractive", BROWSER_ENABLED="false", DOMAIN_DELAY_SECONDS="0",
    STORAGE_DIR=tempfile.mkdtemp(prefix="cairn-test-"), ALLOW_REGISTRATION="true",
)

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app import auth  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_html(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture(scope="session", autouse=True)
def migrated():
    cfg = Config(str(Path(__file__).parent.parent / "alembic.ini"))
    cfg.attributes["configure_logger"] = False
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield
    engine.dispose()


@pytest.fixture(autouse=True)
def clean_db():
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE users CASCADE"))
    for limiter in (auth.login_limiter, auth.ingest_limiter, auth.ai_limiter):
        limiter.hits.clear()
    yield


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


def make_client(email: str = "alice@example.com", password: str = "correct horse battery") -> TestClient:
    from app.main import app

    client = TestClient(app)
    r = client.post("/api/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    client.user_id = r.json()["user"]["id"]
    return client


@pytest.fixture
def client() -> TestClient:
    return make_client()
