"""Auto-extracted notifications routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


@router.get("/notifications")
async def get_notifications(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    unread_only: bool = False,
    limit: int = 50,
):
    """Get notifications for the authenticated user."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    
    query = {"recipient_id": user_id}
    if unread_only:
        query["read"] = False
    
    notifications = await db.notifications.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    
    return {"notifications": notifications, "unread_count": len([n for n in notifications if not n.get("read")])}


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Mark a notification as read."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    
    result = await db.notifications.update_one(
        {"id": notification_id, "recipient_id": user_id},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(404, "Notification not found")
    
    return {"message": "Notification marked as read"}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Mark all notifications as read for the authenticated user."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    
    result = await db.notifications.update_many(
        {"recipient_id": user_id, "read": False},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"message": f"Marked {result.modified_count} notifications as read"}


@router.delete("/notifications/{notification_id}")
async def delete_notification(notification_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Delete a notification."""
    if not credentials:
        raise HTTPException(401, "Authentication required")
    
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    
    result = await db.notifications.delete_one({"id": notification_id, "recipient_id": user_id})
    
    if result.deleted_count == 0:
        raise HTTPException(404, "Notification not found")
    
    return {"message": "Notification deleted"}


@router.post("/notifications/register")
async def register_push_token(body: PushTokenRegister):
    """Register a push token for a user."""
    # Store the push token in the user's document
    if body.user_type == "driver":
        await db.drivers.update_one(
            {"id": body.user_id},
            {"$set": {"push_token": body.push_token, "push_platform": body.platform}}
        )
    else:
        await db.shippers.update_one(
            {"id": body.user_id},
            {"$set": {"push_token": body.push_token, "push_platform": body.platform}}
        )
    
    logger.info(f"Registered push token for {body.user_type} {body.user_id}")
    return {"message": "Push token registered"}
