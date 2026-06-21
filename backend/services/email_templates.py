"""Branded, mobile-responsive HTML email templates for Nadaruns.

A single ``branded`` wrapper provides consistent header/footer/logo so every
template stays on-brand. Specific helpers return (subject, html).
"""
from __future__ import annotations

from typing import Optional

BRAND_NAME = "Nadaruns"
BRAND_COLOR = "#0B6E4F"      # Nadaruns green
BRAND_DARK = "#0A2540"
ACCENT = "#0B6E4F"
SUPPORT_EMAIL = "support@nadaruns.com"


def _rows(pairs: list[tuple[str, str]]) -> str:
    out = []
    for label, value in pairs:
        if value is None or value == "":
            continue
        out.append(
            f'<tr>'
            f'<td style="padding:8px 0;color:#64748B;font-size:14px;">{label}</td>'
            f'<td style="padding:8px 0;color:#0A2540;font-size:14px;font-weight:600;text-align:right;">{value}</td>'
            f'</tr>'
        )
    return "".join(out)


def branded(
    title: str,
    greeting: str,
    body_html: str,
    *,
    cta_label: Optional[str] = None,
    cta_url: Optional[str] = None,
) -> str:
    cta = ""
    if cta_label and cta_url:
        cta = (
            f'<tr><td style="padding:24px 0 8px;">'
            f'<a href="{cta_url}" style="background:{BRAND_COLOR};color:#fff;text-decoration:none;'
            f'padding:12px 28px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block;">{cta_label}</a>'
            f'</td></tr>'
        )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="background:{BRAND_DARK};padding:22px 28px;">
          <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">{BRAND_NAME}</span>
          <span style="color:{BRAND_COLOR};font-size:22px;font-weight:800;">.</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 6px;font-size:20px;color:#0A2540;">{title}</h1>
          <p style="margin:0 0 16px;color:#475569;font-size:15px;">{greeting}</p>
          {body_html}
          <table role="presentation" width="100%">{cta}</table>
        </td></tr>
        <tr><td style="padding:18px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0;">
          <p style="margin:0;color:#94A3B8;font-size:12px;line-height:18px;">
            You're receiving this because you have a {BRAND_NAME} account.<br>
            Questions? Contact <a href="mailto:{SUPPORT_EMAIL}" style="color:{BRAND_COLOR};">{SUPPORT_EMAIL}</a>.<br>
            &copy; {BRAND_NAME} — Smart logistics for Finland.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _details_card(pairs: list[tuple[str, str]]) -> str:
    return (
        f'<table role="presentation" width="100%" style="background:#F8FAFC;border:1px solid #E2E8F0;'
        f'border-radius:12px;padding:8px 16px;margin:8px 0;">{_rows(pairs)}</table>'
    )


# ---------------- Authentication ----------------

def welcome(name: str, role: str = "driver") -> tuple[str, str]:
    return (
        f"Welcome to {BRAND_NAME}!",
        branded(
            f"Welcome aboard, {name}!",
            f"Your {role} account is ready. Here's what you can do next.",
            "<p style='color:#475569;font-size:15px;'>Complete your profile, add your vehicle details, "
            "and start moving loads across Finland with smart, route-aware matching.</p>",
        ),
    )


def password_reset(name: str, reset_url: str) -> tuple[str, str]:
    return (
        f"{BRAND_NAME} password reset",
        branded(
            "Reset your password",
            f"Hi {name}, we received a request to reset your password.",
            "<p style='color:#475569;font-size:15px;'>Click the button below to choose a new password. "
            "If you didn't request this, you can safely ignore this email.</p>",
            cta_label="Reset password", cta_url=reset_url,
        ),
    )


def password_changed(name: str) -> tuple[str, str]:
    return (
        f"Your {BRAND_NAME} password was changed",
        branded(
            "Password changed",
            f"Hi {name}, your password was just updated.",
            f"<p style='color:#475569;font-size:15px;'>If this wasn't you, please contact "
            f"<a href='mailto:{SUPPORT_EMAIL}'>{SUPPORT_EMAIL}</a> immediately.</p>",
        ),
    )


# ---------------- Driver operations ----------------

def driver_registration_received(name: str) -> tuple[str, str]:
    return (
        f"{BRAND_NAME} — registration received",
        branded(
            "Registration received",
            f"Thanks {name}! We've received your driver registration.",
            "<p style='color:#475569;font-size:15px;'>Our team will review your documents and notify you "
            "once your account is approved. This usually takes 1–2 business days.</p>",
        ),
    )


def driver_approved(name: str) -> tuple[str, str]:
    return (
        f"You're approved to drive with {BRAND_NAME}!",
        branded(
            "You're approved! 🎉",
            f"Congratulations {name}, your driver account is now active.",
            "<p style='color:#475569;font-size:15px;'>You can now go online and start accepting jobs.</p>",
        ),
    )


def driver_rejected(name: str, reason: str = "") -> tuple[str, str]:
    body = "<p style='color:#475569;font-size:15px;'>Unfortunately we couldn't approve your registration at this time.</p>"
    if reason:
        body += _details_card([("Reason", reason)])
    return (
        f"{BRAND_NAME} registration update",
        branded("Registration not approved", f"Hi {name},", body),
    )


def withdrawal_invoice(name: str, data: dict) -> tuple[str, str]:
    body = (
        "<p style='color:#475569;font-size:15px;'>We've received your withdrawal request. Your invoice is attached as a PDF.</p>"
        + _details_card([
            ("Invoice #", data.get("invoice_number", "")),
            ("Amount", f"€{float(data.get('amount', 0)):.2f}"),
            ("Method", str(data.get("method", "")).replace("_", " ").title()),
            ("Status", "Pending"),
            ("Date", data.get("date", "")),
        ])
    )
    return (f"Withdrawal invoice {data.get('invoice_number','')}",
            branded("Withdrawal requested", f"Hi {name},", body))


def withdrawal_receipt(name: str, data: dict) -> tuple[str, str]:
    body = (
        "<p style='color:#475569;font-size:15px;'>Your withdrawal has been paid. A receipt is attached as a PDF.</p>"
        + _details_card([
            ("Receipt #", data.get("receipt_number", "")),
            ("Amount", f"€{float(data.get('amount', 0)):.2f}"),
            ("Method", str(data.get("method", "")).replace("_", " ").title()),
            ("Reference", data.get("reference", "")),
            ("Status", "Paid"),
            ("Paid on", data.get("paid_at", "")),
        ])
    )
    return (f"Payment receipt {data.get('receipt_number','')}",
            branded("Payment sent ✅", f"Hi {name},", body))


def shipment_assigned(name: str, order_no: str) -> tuple[str, str]:
    return (f"New shipment assigned — {order_no}",
            branded("New shipment assigned", f"Hi {name}, a new shipment is waiting for you.",
                    _details_card([("Order", order_no)])))


# ---------------- Shipper operations ----------------

def order_created(name: str, data: dict) -> tuple[str, str]:
    body = _details_card([
        ("Order", data.get("order_number", "")),
        ("Pickup", data.get("pickup", "")),
        ("Dropoff", data.get("dropoff", "")),
        ("Estimated price", f"€{float(data.get('price', 0)):.2f}"),
    ])
    return (f"Order created — {data.get('order_number','')}",
            branded("Your order is created", f"Hi {name}, we're finding the right driver for you.", body))


def driver_assigned(name: str, data: dict) -> tuple[str, str]:
    body = _details_card([
        ("Order", data.get("order_number", "")),
        ("Driver", data.get("driver_name", "")),
        ("Vehicle", data.get("vehicle", "")),
    ])
    return (f"Driver assigned — {data.get('order_number','')}",
            branded("A driver is on the way", f"Hi {name}, your shipment has been picked up by a driver.", body))


def shipment_status(name: str, order_no: str, status_label: str) -> tuple[str, str]:
    return (f"{status_label} — {order_no}",
            branded(status_label, f"Hi {name}, an update on your shipment.",
                    _details_card([("Order", order_no), ("Status", status_label)])))


def payment_invoice(name: str, data: dict) -> tuple[str, str]:
    body = (
        "<p style='color:#475569;font-size:15px;'>Thanks for your order. Your invoice is attached as a PDF.</p>"
        + _details_card([
            ("Invoice #", data.get("invoice_number", "")),
            ("Order", data.get("order_number", "")),
            ("Shipment ID", data.get("shipment_id", "")),
            ("Amount", f"€{float(data.get('amount', 0)):.2f}"),
            ("VAT", f"€{float(data.get('vat', 0)):.2f}" if data.get("vat") else "—"),
            ("Date", data.get("date", "")),
        ])
    )
    return (f"Invoice {data.get('invoice_number','')}",
            branded("Payment invoice", f"Hi {name},", body))


def payment_receipt(name: str, data: dict) -> tuple[str, str]:
    body = (
        "<p style='color:#475569;font-size:15px;'>We've received your payment. A receipt is attached as a PDF.</p>"
        + _details_card([
            ("Receipt #", data.get("receipt_number", "")),
            ("Order", data.get("order_number", "")),
            ("Shipment ID", data.get("shipment_id", "")),
            ("Amount paid", f"€{float(data.get('amount', 0)):.2f}"),
            ("Paid on", data.get("paid_at", "")),
        ])
    )
    return (f"Payment receipt {data.get('receipt_number','')}",
            branded("Payment received ✅", f"Hi {name},", body))


# ---------------- Admin notifications ----------------

def admin_notice(title: str, lines: list[tuple[str, str]]) -> tuple[str, str]:
    return (f"[{BRAND_NAME} admin] {title}",
            branded(title, "A new event needs your attention.", _details_card(lines)))


def test_email() -> tuple[str, str]:
    return (
        f"{BRAND_NAME} email is working ✅",
        branded("Email infrastructure is live",
                "This is a test email from your Nadaruns platform.",
                "<p style='color:#475569;font-size:15px;'>If you can read this, transactional email "
                "(Brevo) is configured correctly and ready for invoices, receipts and notifications.</p>"),
    )
