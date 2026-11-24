"""File storage for screenshots, thumbnails and favicons.
shortcut: local filesystem only; add an S3-compatible implementation of put/path/delete_prefix for production."""

import shutil
from pathlib import Path

from app.config import settings


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not p.is_relative_to(self.root):
            raise ValueError("Invalid storage key")
        return p

    def put(self, key: str, data: bytes) -> str:
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return key

    def delete_prefix(self, prefix: str) -> None:
        shutil.rmtree(self.path(prefix), ignore_errors=True)


storage = LocalStorage(settings.storage_dir)
