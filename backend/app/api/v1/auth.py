"""
auth.py — User authentication & management routes.

  GET    /auth/setup           → { required: bool }  — true if no users exist yet
  POST   /auth/register        → Create FIRST admin account (blocked once users exist)
  POST   /auth/login           → { access_token, token_type, user }
  POST   /auth/refresh         → rotate tokens  (uses HttpOnly refresh cookie)
  POST   /auth/logout          → clears refresh cookie
  GET    /auth/me              → current user info
  PATCH  /auth/me              → update own username / password
  GET    /auth/users           → list all users   (admin only)
  POST   /auth/users           → create a user    (admin only)
  PATCH  /auth/users/{id}      → update a user    (admin only)
  DELETE /auth/users/{id}      → delete a user    (admin only)
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import create_access_token, decode_access_token
from app.db.session import get_db
from app.repositories.user_repo import user_repo

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Schemas ────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class UpdateMeRequest(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=64)
    password: str | None = Field(default=None, min_length=8, max_length=128)


class AdminCreateUserRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    is_admin: bool = False


class AdminUpdateUserRequest(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=64)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    is_admin: bool | None = None


class UserOut(BaseModel):
    id: int
    username: str
    is_admin: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ── Internal helpers ───────────────────────────────────────────────────────────

_REFRESH_COOKIE = "sw_refresh"


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=_REFRESH_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # flip to True behind HTTPS in production
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/v1/auth",
    )


def _issue_tokens(response: Response, user_id: int) -> str:
    """Mint access token + set refresh cookie. Returns the access token string."""
    access = create_access_token(str(user_id))
    refresh = create_access_token(str(user_id))
    _set_refresh_cookie(response, refresh)
    return access


def _resolve_user(authorization: str | None, db: Session):
    """Validate Bearer token and return the User row. Raises 401 on failure."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    token = authorization[7:]
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = user_repo.get_by_id(db, int(user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def _require_admin(authorization: str | None, db: Session):
    user = _resolve_user(authorization, db)
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


# ── Public routes ──────────────────────────────────────────────────────────────

@router.get("/setup")
def check_setup(db: Session = Depends(get_db)):
    """Returns whether first-time registration is still allowed."""
    return {"required": user_repo.count(db) == 0}


@router.post("/register", response_model=TokenOut, status_code=201)
def register(body: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    """Create the first admin account. Returns 403 once any user exists."""
    if user_repo.count(db) > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is closed. Ask an admin to create your account.",
        )
    if user_repo.get_by_username(db, body.username):
        raise HTTPException(status_code=409, detail="Username already taken")
    user = user_repo.create(db, username=body.username, password=body.password, is_admin=True)
    access = _issue_tokens(response, user.id)
    return TokenOut(access_token=access, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = user_repo.get_by_username(db, body.username)
    if not user or not user_repo.verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    access = _issue_tokens(response, user.id)
    return TokenOut(access_token=access, user=UserOut.model_validate(user))


@router.post("/refresh", response_model=TokenOut)
def refresh_tokens(
    response: Response,
    sw_refresh: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    if not sw_refresh:
        raise HTTPException(status_code=401, detail="No refresh token")
    user_id = decode_access_token(sw_refresh)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    user = user_repo.get_by_id(db, int(user_id))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    access = _issue_tokens(response, user.id)
    return TokenOut(access_token=access, user=UserOut.model_validate(user))


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(key=_REFRESH_COOKIE, path="/api/v1/auth")


# ---------------------------------------------------------------------------
# Authenticated user routes
# ---------------------------------------------------------------------------

@router.get("/me", response_model=UserOut)
def get_me(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user = _resolve_user(authorization, db)
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
def update_me(
    body: UpdateMeRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user = _resolve_user(authorization, db)
    if body.username and body.username != user.username:
        if user_repo.get_by_username(db, body.username):
            raise HTTPException(status_code=409, detail="Username already taken")
    updated = user_repo.update(db, user, username=body.username, password=body.password)
    return UserOut.model_validate(updated)


# ---------------------------------------------------------------------------
# Admin user management routes
# ---------------------------------------------------------------------------

@router.get("/users", response_model=list[UserOut])
def list_users(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_admin(authorization, db)
    return [UserOut.model_validate(u) for u in user_repo.list_all(db)]


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    body: AdminCreateUserRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_admin(authorization, db)
    if user_repo.get_by_username(db, body.username):
        raise HTTPException(status_code=409, detail="Username already taken")
    user = user_repo.create(db, username=body.username, password=body.password, is_admin=body.is_admin)
    return UserOut.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: AdminUpdateUserRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    admin = _require_admin(authorization, db)
    target = user_repo.get_by_id(db, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if body.is_admin is False and target.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot remove your own admin privileges")
    if body.username and body.username != target.username:
        if user_repo.get_by_username(db, body.username):
            raise HTTPException(status_code=409, detail="Username already taken")
    updated = user_repo.update(
        db, target,
        username=body.username,
        password=body.password,
        is_admin=body.is_admin,
    )
    return UserOut.model_validate(updated)


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    admin = _require_admin(authorization, db)
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target = user_repo.get_by_id(db, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    user_repo.delete(db, user_id)

