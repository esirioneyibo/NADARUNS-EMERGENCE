"""Auto-extracted invoices routes. Handler bodies are unchanged; shared names
(db, models, helpers, FastAPI symbols) are injected from the server module."""
from fastapi import APIRouter
import server as _srv

_g = globals()
for _k in dir(_srv):
    if not _k.startswith('__'):
        _g.setdefault(_k, getattr(_srv, _k))

router = APIRouter()


@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(401, "Authentication required")
    payload = decode_token(credentials.credentials)
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        inv = await db.invoices.find_one({"invoice_number": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    # Shippers may only view their own invoices; admins may view all.
    if payload.get("type") == "shipper" and inv.get("shipper_id") != payload.get("sub"):
        raise HTTPException(403, "Not authorized to view this invoice")
    return inv


@router.get("/invoices/{invoice_id}/pdf")
async def get_invoice_pdf(invoice_id: str, token: Optional[str] = None,
                          credentials: HTTPAuthorizationCredentials = Depends(security)):
    from fastapi.responses import Response
    # Allow either header auth or ?token= (for direct browser downloads).
    raw = credentials.credentials if credentials else token
    if not raw:
        raise HTTPException(401, "Authentication required")
    payload = decode_token(raw)
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0}) \
        or await db.invoices.find_one({"invoice_number": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if payload.get("type") == "shipper" and inv.get("shipper_id") != payload.get("sub"):
        raise HTTPException(403, "Not authorized")
    pdf_bytes = _build_invoice_pdf(inv)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={inv['invoice_number']}.pdf"},
    )
