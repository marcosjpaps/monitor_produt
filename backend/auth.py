"""Autenticação server-side do Monitor Agrícola (sessões assinadas, sem senha no navegador)."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from fastapi import Request
from fastapi.responses import JSONResponse

COOKIE_NAME = "agromonitor_session"
MAX_AGE_SESSION = 24 * 60 * 60
MAX_AGE_REMEMBERED = 14 * 24 * 60 * 60
_FAILED: dict[str, list[int]] = {}


def _secret() -> bytes:
    value = os.environ.get("APP_SECRET_KEY", "")
    if len(value) < 32:
        raise RuntimeError("APP_SECRET_KEY ausente ou muito curta (min. 32 caracteres)")
    return value.encode("utf-8")


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def create_session(email: str, remember: bool) -> tuple[str, int]:
    age = MAX_AGE_REMEMBERED if remember else MAX_AGE_SESSION
    payload = {
        "sub": email.lower(),
        "iat": int(time.time()),
        "exp": int(time.time()) + age,
        "nonce": secrets.token_hex(12),
    }
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _b64(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return body + "." + signature, age


def current_user(request: Request) -> str | None:
    token = request.cookies.get(COOKIE_NAME, "")
    try:
        body, signature = token.split(".", 1)
        expected = _b64(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(_unb64(body))
        if not isinstance(payload, dict):
            return None
        now = int(time.time())
        if not (isinstance(payload.get("exp"), int) and now < payload["exp"] and
                isinstance(payload.get("iat"), int) and payload["iat"] <= now and
                now - payload["iat"] <= MAX_AGE_REMEMBERED):
            return None
        configured_email = os.environ.get("APP_ADMIN_EMAIL", "").strip().lower()
        subject = payload.get("sub")
        if configured_email and isinstance(subject, str) and hmac.compare_digest(subject, configured_email):
            return configured_email
    except (ValueError, TypeError, UnicodeError, KeyError, RuntimeError, OverflowError):
        pass
    return None


def check_credentials(email: str, password: str, client_id: str) -> tuple[bool, int]:
    now = int(time.time())
    attempts = [t for t in _FAILED.get(client_id, []) if now - t < 15 * 60]
    if len(attempts) >= 8:
        _FAILED[client_id] = attempts
        return False, 429
    configured_email = os.environ.get("APP_ADMIN_EMAIL", "").strip().lower()
    configured_password = os.environ.get("APP_ADMIN_PASSWORD", "")
    if not configured_email or not configured_password or len(os.environ.get("APP_SECRET_KEY", "")) < 32:
        return False, 503
    valid = (
        hmac.compare_digest(email.strip().lower(), configured_email)
        and hmac.compare_digest(password, configured_password)
    )
    if valid:
        _FAILED.pop(client_id, None)
    else:
        attempts.append(now)
        _FAILED[client_id] = attempts
        if len(_FAILED) > 3000:
            _FAILED.clear()
    return valid, 200 if valid else 401


def forbid() -> JSONResponse:
    return JSONResponse({"error": "Sessão expirada ou acesso não autorizado."}, status_code=401)
