"""Stripe payment service for the NadaRuns logistics marketplace.

Implements an AUTHORIZE -> CAPTURE flow:
  * At booking, the shipper authorizes payment (a hold is placed on the card)
    using a Stripe Checkout Session whose PaymentIntent uses
    ``capture_method="manual"``.
  * On delivery completion (or via the admin dashboard) the platform captures
    the previously authorized funds.

Driver payouts are tracked in MongoDB and paid out MANUALLY by an admin
(no Stripe Connect). The platform commission is the difference between the
total charged to the shipper and the driver's share.

All amounts on the Stripe side are integers in the smallest currency unit
(cents). EUR is the platform currency.
"""

import os
import logging
from pathlib import Path

import stripe
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Ensure the backend .env is loaded before reading keys (this module may be
# imported before server.py calls load_dotenv).
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
# The pod provisions the Stripe TEST secret key as STRIPE_API_KEY. We also
# accept STRIPE_SECRET_KEY as an alias for portability.
STRIPE_SECRET_KEY = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PUBLISHABLE_KEY = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")

CURRENCY = "eur"

if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY
else:  # pragma: no cover - configuration guard
    logger.warning("STRIPE_API_KEY is not set; Stripe calls will fail until configured.")


def is_configured() -> bool:
    """True when a Stripe secret key is available."""
    return bool(STRIPE_SECRET_KEY)


def to_cents(amount_eur: float) -> int:
    """Convert a EUR float amount into integer cents."""
    return int(round(float(amount_eur or 0) * 100))


def from_cents(amount_cents: int) -> float:
    """Convert integer cents into a EUR float amount."""
    return round(int(amount_cents or 0) / 100.0, 2)


def commission_split(total_eur: float, driver_eur: float) -> dict:
    """Compute the platform commission split for an order.

    The driver's share is already computed by the pricing engine (80% of the
    base price + 100% of any shipper bonus). The platform commission is simply
    whatever is left of the total the shipper pays.
    """
    total = round(float(total_eur or 0), 2)
    driver = round(min(float(driver_eur or 0), total), 2)
    commission = round(total - driver, 2)
    rate = round((commission / total) * 100, 2) if total > 0 else 0.0
    return {
        "gross_amount": total,
        "driver_amount": driver,
        "commission_amount": commission,
        "commission_rate": rate,
    }


# ----------------------------------------------------------------------------
# Stripe API wrappers
# ----------------------------------------------------------------------------

def create_checkout_session(
    *,
    order_id: str,
    order_number: str,
    amount_eur: float,
    success_url: str,
    cancel_url: str,
    metadata: dict | None = None,
) -> stripe.checkout.Session:
    """Create a Checkout Session that AUTHORIZES (manual capture) the payment.

    Checkout (hosted page) is used instead of the mobile PaymentSheet so the
    flow works on web preview, Expo Go and native dev builds without bundling
    native Stripe modules, while remaining a standard manual-capture
    PaymentIntent under the hood.
    """
    md = {"order_id": order_id, "order_number": order_number}
    if metadata:
        md.update({k: str(v) for k, v in metadata.items() if v is not None})

    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[{
            "price_data": {
                "currency": CURRENCY,
                "product_data": {
                    "name": f"NadaRuns shipment {order_number}",
                    "description": "Logistics delivery — payment authorized now, captured on delivery.",
                },
                "unit_amount": to_cents(amount_eur),
            },
            "quantity": 1,
        }],
        payment_intent_data={
            "capture_method": "manual",
            "metadata": md,
        },
        metadata=md,
        success_url=success_url,
        cancel_url=cancel_url,
    )
    return session


def retrieve_session(session_id: str) -> stripe.checkout.Session:
    return stripe.checkout.Session.retrieve(session_id)


def retrieve_payment_intent(intent_id: str) -> stripe.PaymentIntent:
    return stripe.PaymentIntent.retrieve(intent_id)


def capture_payment_intent(intent_id: str, amount_cents: int | None = None) -> stripe.PaymentIntent:
    """Capture a previously authorized PaymentIntent.

    Optionally capture a smaller amount (releasing the remaining hold) when the
    final delivery cost is lower than the authorized amount.
    """
    if amount_cents is not None:
        return stripe.PaymentIntent.capture(intent_id, amount_to_capture=amount_cents)
    return stripe.PaymentIntent.capture(intent_id)


def cancel_payment_intent(intent_id: str) -> stripe.PaymentIntent:
    """Cancel an authorization, releasing the hold on the customer's card."""
    return stripe.PaymentIntent.cancel(intent_id)


def construct_webhook_event(payload: bytes, sig_header: str):
    """Verify a webhook signature and return the parsed event.

    Raises stripe.error.SignatureVerificationError / ValueError on failure.
    """
    return stripe.Webhook.construct_event(
        payload=payload,
        sig_header=sig_header,
        secret=STRIPE_WEBHOOK_SECRET,
    )


def map_intent_status(intent_status: str) -> str:
    """Map a Stripe PaymentIntent status to our internal payment_status."""
    mapping = {
        "requires_payment_method": "pending",
        "requires_confirmation": "pending",
        "requires_action": "pending",
        "processing": "pending",
        "requires_capture": "authorized",
        "succeeded": "captured",
        "canceled": "canceled",
    }
    return mapping.get(intent_status, "pending")
