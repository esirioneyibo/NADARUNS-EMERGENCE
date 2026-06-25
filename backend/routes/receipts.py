"""Auto-extracted receipts routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


@router.get("/receipts/{receipt_id}/pdf")
async def get_receipt_pdf(receipt_id: str, token: Optional[str] = None,
                          credentials: HTTPAuthorizationCredentials = Depends(security)):
    from fastapi.responses import Response
    raw = credentials.credentials if credentials else token
    if not raw:
        raise HTTPException(401, "Authentication required")
    payload = decode_token(raw)
    rec = await db.receipts.find_one({"id": receipt_id}, {"_id": 0}) \
        or await db.receipts.find_one({"receipt_number": receipt_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Receipt not found")
    # Owners may view their own; admins view all.
    if payload.get("type") != "admin" and rec.get("user_id") != payload.get("sub"):
        raise HTTPException(403, "Not authorized")
    pdf_bytes = _receipt_pdf(rec)
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={rec['receipt_number']}.pdf"},
    )
