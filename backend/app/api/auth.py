import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import (
    COOKIE_NAME,
    client_ip,
    current_user,
    hash_password,
    hash_token,
    issue_token,
    login_limiter,
    set_session_cookie,
    verify_password,
)
from app.config import settings
from app.db import get_db
from app.models import ApiToken, User
from app.schemas import AuthOut, Credentials, TokenCreated, TokenIn, TokenOut, UserOut

router = APIRouter(prefix="/api", tags=["auth"])


def _user_out(u: User) -> UserOut:
    return UserOut(id=u.id, email=u.email, created_at=u.created_at)


@router.post("/auth/register", response_model=AuthOut, status_code=201)
def register(body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    login_limiter.check(f"register:{client_ip(request)}")
    if not settings.allow_registration:
        raise HTTPException(403, "Registration is disabled on this server")
    user = User(email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists") from None
    token = issue_token(db, user, "Web session", ttl_days=settings.session_ttl_days)
    set_session_cookie(response, token)
    return AuthOut(user=_user_out(user), token=token)


@router.post("/auth/login", response_model=AuthOut)
def login(body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    login_limiter.check(f"login:{client_ip(request)}")
    user = db.scalar(select(User).where(User.email == body.email))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    token = issue_token(db, user, "Web session", ttl_days=settings.session_ttl_days)
    set_session_cookie(response, token)
    return AuthOut(user=_user_out(user), token=token)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, user: User = Depends(current_user),
           db: Session = Depends(get_db)):
    db.execute(delete(ApiToken).where(ApiToken.id == request.state.token_id))
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return _user_out(user)


@router.get("/tokens", response_model=list[TokenOut], tags=["tokens"])
def list_tokens(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(ApiToken).where(ApiToken.user_id == user.id, ApiToken.kind == "api")
                      .order_by(ApiToken.created_at.desc()))
    return [TokenOut.model_validate(t, from_attributes=True) for t in rows]


@router.post("/tokens", response_model=TokenCreated, status_code=201, tags=["tokens"])
def create_token(body: TokenIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    token = issue_token(db, user, body.name, kind="api")
    row = db.scalar(select(ApiToken).where(ApiToken.token_hash == hash_token(token)))
    return TokenCreated(**TokenOut.model_validate(row, from_attributes=True).model_dump(), token=token)


@router.delete("/tokens/{token_id}", status_code=204, tags=["tokens"])
def revoke_token(token_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    result = db.execute(delete(ApiToken).where(ApiToken.id == token_id, ApiToken.user_id == user.id))
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Token not found")
