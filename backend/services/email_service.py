"""Provider-agnostic transactional email service for Nadaruns.

Active provider: Brevo (Sendinblue) HTTP API. The provider is selected via the
EMAIL_PROVIDER env var so SendGrid / Amazon SES / Mailgun can be added later
without touching the calling code. Every send is persisted to ``email_logs``
for an audit trail, with retry + dry-run support.
"""
from __future__ import annotations

import os
import uuid
import base64
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger("nadaruns.email")

EMAIL_PROVIDER = os.environ.get("EMAIL_PROVIDER", "brevo").lower()
BREVO_API_KEY = os.environ.get("BREVO_API_KEY", "")
SENDER_EMAIL = os.environ.get("EMAIL_SENDER", "")
SENDER_NAME = os.environ.get("EMAIL_SENDER_NAME", "Nadaruns")
DRY_RUN = os.environ.get("EMAIL_DRY_RUN", "false").lower() == "true"

BREVO_URL = "https://api.brevo.com/v3/smtp/email"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_configured() -> bool:
    if EMAIL_PROVIDER == "brevo":
        return bool(BREVO_API_KEY and SENDER_EMAIL)
    return False


async def _send_brevo(
    to_email: str,
    to_name: Optional[str],
    subject: str,
    html: str,
    attachments: Optional[list],
) -> tuple[bool, Optional[str], Optional[str]]:
    payload: dict = {
        "sender": {"email": SENDER_EMAIL, "name": SENDER_NAME},
        "to": [{"email": to_email, "name": to_name or to_email}],
        "subject": subject,
        "htmlContent": html,
    }
    if attachments:
        payload["attachment"] = [
            {"name": a["name"], "content": a["content"]} for a in attachments
        ]
    headers = {"api-key": BREVO_API_KEY, "content-type": "application/json", "accept": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(BREVO_URL, json=payload, headers=headers)
    if resp.status_code in (200, 201, 202):
        try:
            mid = resp.json().get("messageId")
        except Exception:
            mid = None
        return True, mid, None
    return False, None, f"{resp.status_code}: {resp.text[:300]}"


async def send_email(
    db,
    to_email: str,
    subject: str,
    html: str,
    *,
    to_name: Optional[str] = None,
    attachments: Optional[list] = None,
    category: str = "general",
    related_id: Optional[str] = None,
    retries: int = 2,
) -> dict:
    """Send an email and persist an audit log entry.

    ``attachments`` is a list of {"name": str, "content": base64-str}.
    Returns the persisted log document (without Mongo _id).
    """
    log = {
        "id": str(uuid.uuid4()),
        "to_email": to_email,
        "to_name": to_name,
        "subject": subject,
        "category": category,
        "related_id": related_id,
        "provider": EMAIL_PROVIDER,
        "status": "pending",
        "attempts": 0,
        "provider_message_id": None,
        "error": None,
        "dry_run": False,
        "created_at": _now(),
        "sent_at": None,
    }

    if DRY_RUN or not is_configured():
        log.update({"status": "dry_run", "dry_run": True, "sent_at": _now()})
        if db is not None:
            await db.email_logs.insert_one(dict(log))
        logger.info(f"[email dry-run] to={to_email} subject={subject!r} category={category}")
        log.pop("_id", None)
        return log

    last_err = None
    for attempt in range(1, retries + 2):
        log["attempts"] = attempt
        try:
            if EMAIL_PROVIDER == "brevo":
                ok, mid, err = await _send_brevo(to_email, to_name, subject, html, attachments)
            else:
                ok, mid, err = False, None, f"Unsupported provider {EMAIL_PROVIDER}"
            if ok:
                log.update({"status": "sent", "provider_message_id": mid, "sent_at": _now(), "error": None})
                break
            last_err = err
        except Exception as exc:  # network / unexpected
            last_err = str(exc)
        await asyncio.sleep(min(2 ** attempt, 6))
    else:
        log.update({"status": "failed", "error": last_err})

    if log["status"] != "sent":
        log.update({"status": "failed", "error": last_err})

    if db is not None:
        await db.email_logs.insert_one(dict(log))
    log.pop("_id", None)
    if log["status"] == "sent":
        logger.info(f"[email sent] to={to_email} subject={subject!r} id={log['provider_message_id']}")
    else:
        logger.warning(f"[email failed] to={to_email} subject={subject!r} err={last_err}")
    return log


def pdf_attachment(name: str, pdf_bytes: bytes) -> dict:
    """Build a Brevo-style base64 attachment from raw PDF bytes."""
    return {"name": name, "content": base64.b64encode(pdf_bytes).decode("ascii")}
