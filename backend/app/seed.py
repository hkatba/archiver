"""Seed a (demo) account with URLs: `python -m app.seed --email E --password P --file urls.txt`."""

import argparse
from pathlib import Path

from sqlalchemy import select

from app.auth import hash_password
from app.db import SessionLocal
from app.models import User
from app.services import add_links
from app.urls import extract_urls


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--file", required=True, type=Path)
    args = ap.parse_args()
    if len(args.password) < 8:
        raise SystemExit("Password must be at least 8 characters")
    urls = extract_urls(args.file.read_text(encoding="utf-8"))
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == args.email.lower()))
        if not user:
            user = User(email=args.email.lower(), password_hash=hash_password(args.password))
            db.add(user)
            db.commit()
            print(f"Created user {user.email}")
        result = add_links(db, user.id, urls)
    print(f"Queued {len(result.created)} links ({len(result.duplicates)} already saved, "
          f"{len(result.invalid)} invalid). Start the worker to process them.")


if __name__ == "__main__":
    main()
