import base64
import hashlib
import hmac
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import AppUser, UserRole
from app.db.session import get_db


TOKEN_TTL_HOURS = 8
security = HTTPBearer()


class LoginRequest(BaseModel):
    login_id: str
    password: str


class UserProfile(BaseModel):
    id: str
    login_id: str
    full_name: str
    email: str
    role: UserRole


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfile


def hash_password(password: str, salt: str | None = None) -> str:
    password_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        password_salt.encode("utf-8"),
        120_000,
    ).hex()
    return f"pbkdf2_sha256${password_salt}${digest}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, salt, expected_digest = password_hash.split("$", 2)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    candidate = hash_password(password, salt).split("$", 2)[2]
    return hmac.compare_digest(candidate, expected_digest)


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(f"{data}{padding}")


def create_access_token(user: AppUser) -> str:
    expires_at = datetime.now(UTC) + timedelta(hours=TOKEN_TTL_HOURS)
    payload = {
        "sub": str(user.id),
        "login_id": user.login_id,
        "role": user.role.value,
        "exp": int(expires_at.timestamp()),
    }
    body = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(
        settings.auth_secret_key.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{body}.{_b64encode(signature)}"


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        body, signature = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    expected_signature = hmac.new(
        settings.auth_secret_key.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(_b64decode(signature), expected_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    payload = json.loads(_b64decode(body))
    if int(payload.get("exp", 0)) < int(datetime.now(UTC).timestamp()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    return payload


def user_to_profile(user: AppUser) -> UserProfile:
    return UserProfile(
        id=str(user.id),
        login_id=user.login_id,
        full_name=user.full_name,
        email=user.email,
        role=user.role,
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> AppUser:
    payload = decode_access_token(credentials.credentials)
    user = db.scalar(
        select(AppUser).where(AppUser.id == uuid.UUID(payload["sub"]), AppUser.is_active.is_(True))
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_roles(*roles: UserRole):
    def dependency(current_user: AppUser = Depends(get_current_user)) -> AppUser:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this resource",
            )
        return current_user

    return dependency


def seed_demo_users(db: Session) -> None:
    seed_users = [
        ("Admin1", "admin123", "Admin One", "admin1@dhl.local", UserRole.admin),
        ("Reviewer1", "reviewer123", "Reviewer One", "reviewer1@dhl.local", UserRole.reviewer),
        ("Editor1", "editor123", "Editor One", "editor1@dhl.local", UserRole.editor),
    ]

    for login_id, password, full_name, email, role in seed_users:
        user = db.scalar(select(AppUser).where(AppUser.login_id == login_id))
        if user is None:
            db.add(
                AppUser(
                    login_id=login_id,
                    full_name=full_name,
                    email=email,
                    password_hash=hash_password(password),
                    role=role,
                )
            )
            continue

        user.full_name = full_name
        user.email = email
        user.role = role
        user.is_active = True

    db.commit()
