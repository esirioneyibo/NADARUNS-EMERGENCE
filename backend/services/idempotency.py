"""Idempotency-key support for unsafe (POST) operations.

Delivery systems must tolerate client retries on flaky mobile networks
without creating duplicate jobs or double-charging. Clients send an
`Idempotency-Key` header; if we've already processed that key for the given
scope we replay the stored result instead of executing the operation again.

Storage lives in the `idempotency_keys` collection. A TTL index (created at
startup) expires keys after 24h so the collection stays small.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


def extract_key(request) -> Optional[str]:
    """Pull the Idempotency-Key from request headers (case-insensitive)."""
    if request is None:
        return None
    key = request.headers.get("Idempotency-Key") or request.headers.get("idempotency-key")
    return key.strip() if key else None


async def get_existing(db, key: Optional[str], scope: str) -> Optional[dict]:
    """Return the stored record for this key+scope, or None."""
    if not key:
        return None
    try:
        return await db.idempotency_keys.find_one(
            {"key": key, "scope": scope}, {"_id": 0}
        )
    except Exception as exc:
        logger.warning("Idempotency lookup failed (%s/%s): %s", scope, key, exc)
        return None


async def store(db, key: Optional[str], scope: str, response: dict) -> None:
    """Persist the successful response for replay on retry."""
    if not key:
        return
    try:
        await db.idempotency_keys.update_one(
            {"key": key, "scope": scope},
            {"$set": {
                "key": key,
                "scope": scope,
                "response": response,
                "created_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
    except Exception as exc:
        logger.warning("Idempotency store failed (%s/%s): %s", scope, key, exc)
