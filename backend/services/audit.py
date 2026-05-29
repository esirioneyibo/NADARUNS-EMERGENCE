"""Append-only audit trail for the order lifecycle.

Every meaningful order event (status change, creation, cancellation, photo,
otp verification, rating) is recorded in the `order_events` collection so we
have a complete, immutable timeline for support, dispute resolution and
debugging. This is critical for a delivery system where money + SLAs are
involved.

Records are best-effort and never block the main request: callers should
treat audit failures as non-fatal.
"""

import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


async def record_event(
    db,
    order_id: str,
    event_type: str,
    *,
    from_status: Optional[str] = None,
    to_status: Optional[str] = None,
    actor_id: Optional[str] = None,
    actor_type: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> Optional[dict]:
    """Append an event to the order's immutable audit log.

    Returns the stored event (without Mongo _id) or None on failure.
    """
    event = {
        "id": str(uuid.uuid4()),
        "order_id": order_id,
        "event_type": event_type,
        "from_status": from_status,
        "to_status": to_status,
        "actor_id": actor_id,
        "actor_type": actor_type,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.order_events.insert_one(dict(event))
    except Exception as exc:  # never break the request because auditing failed
        logger.warning("Failed to record order event for %s: %s", order_id, exc)
        return None
    return event


async def get_events(db, order_id: str) -> list:
    """Return the chronological event timeline for an order."""
    cursor = db.order_events.find({"order_id": order_id}, {"_id": 0}).sort("created_at", 1)
    return await cursor.to_list(1000)
