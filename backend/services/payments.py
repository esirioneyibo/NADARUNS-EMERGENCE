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
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

# ----------------------------------------------------------------------------
# Configuration (dynamic — admin can switch test/live at runtime)
# ----------------------------------------------------------------------------
CURRENCY = "eur"

STRIPE_TEST_KEY = ""
STRIPE_LIVE_KEY = ""
STRIPE_MODE = "test"            # "test" | "live"
STRIPE_SECRET_KEY = ""          # currently ACTIVE secret key
STRIPE_WEBHOOK_SECRET = ""      # currently ACTIVE webhook signing secret
STRIPE_PUBLISHABLE_KEY = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")


def configure(*, test_key=None, live_key=None, mode=None, webhook_secret=None):
    """Update Stripe credentials/mode and point the SDK at the active key.

    Any argument left as None keeps its current value. Returns get_status().
    """
    global STRIPE_TEST_KEY, STRIPE_LIVE_KEY, STRIPE_MODE, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
    if test_key is not None:
        STRIPE_TEST_KEY = (test_key or "").strip()
    if live_key is not None:
        STRIPE_LIVE_KEY = (live_key or "").strip()
    if mode in ("test", "live"):
        STRIPE_MODE = mode
    if webhook_secret is not None:
        STRIPE_WEBHOOK_SECRET = (webhook_secret or "").strip()
    STRIPE_SECRET_KEY = STRIPE_LIVE_KEY if STRIPE_MODE == "live" else STRIPE_TEST_KEY
    if STRIPE_SECRET_KEY:
        stripe.api_key = STRIPE_SECRET_KEY
    else:
        logger.warning("No Stripe key for mode '%s'; Stripe calls will fail until configured.", STRIPE_MODE)
    return get_status()


def _mask(k: str):
    if not k:
        return None
    return f"{k[:11]}…{k[-4:]}" if len(k) > 16 else "set"


def get_status() -> dict:
    return {
        "configured": bool(STRIPE_SECRET_KEY),
        "mode": STRIPE_MODE,
        "currency": "EUR",
        "test_configured": bool(STRIPE_TEST_KEY),
        "live_configured": bool(STRIPE_LIVE_KEY),
        "test_key_masked": _mask(STRIPE_TEST_KEY),
        "live_key_masked": _mask(STRIPE_LIVE_KEY),
        "webhook_configured": bool(STRIPE_WEBHOOK_SECRET),
        "webhook_secret_masked": _mask(STRIPE_WEBHOOK_SECRET),
        "active_key_masked": _mask(STRIPE_SECRET_KEY),
    }


def validate_key(key: str):
    """Lightweight live check that a secret key is valid. Returns (ok, error)."""
    if not key:
        return False, "Empty key"
    try:
        stripe.Account.retrieve(api_key=key)
        return True, None
    except Exception as exc:  # invalid key / network
        return False, str(exc)


# Seed credentials from the environment on import (STRIPE_API_KEY / STRIPE_SECRET_KEY).
def _bootstrap_from_env():
    env_key = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY", "")
    env_key = (env_key or "").strip()
    test_k = env_key if env_key.startswith("sk_test_") else ""
    live_k = env_key if env_key.startswith("sk_live_") else ""
    wh = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    boot_mode = "live" if (live_k and not test_k) else "test"
    configure(test_key=test_k, live_key=live_k, mode=boot_mode, webhook_secret=wh)


_bootstrap_from_env()


def is_configured() -> bool:
    """True when an active Stripe secret key is available."""
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


def refund_payment_intent(
    intent_id: str,
    amount_cents: int | None = None,
    idempotency_key: str | None = None,
) -> "stripe.Refund":
    """Refund a CAPTURED PaymentIntent (full when amount_cents is None, else partial).

    Use an idempotency key so a retried HTTP request never double-refunds.
    Only valid once funds are captured — for an authorization that has not been
    captured yet, cancel the PaymentIntent instead.
    """
    params: dict = {"payment_intent": intent_id}
    if amount_cents is not None:
        params["amount"] = int(amount_cents)
    return stripe.Refund.create(idempotency_key=idempotency_key, **params)


def create_test_authorization(amount_eur: float, metadata: dict | None = None) -> stripe.PaymentIntent:
    """Create + confirm a manual-capture PaymentIntent using a Stripe test card.

    QA / automation helper only: lets the test suite drive the full
    authorize -> capture flow without completing the hosted Checkout page.
    Guarded by the caller to TEST keys only.
    """
    return stripe.PaymentIntent.create(
        amount=to_cents(amount_eur),
        currency=CURRENCY,
        capture_method="manual",
        payment_method="pm_card_visa",
        confirm=True,
        automatic_payment_methods={"enabled": True, "allow_redirects": "never"},
        metadata={k: str(v) for k, v in (metadata or {}).items() if v is not None},
    )


def is_test_key() -> bool:
    return STRIPE_SECRET_KEY.startswith("sk_test_")


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


# ----------------------------------------------------------------------------
# Saved payment methods (SetupIntent via hosted Checkout in setup mode)
# ----------------------------------------------------------------------------

def create_customer(*, email: str | None, name: str | None, metadata: dict | None = None) -> stripe.Customer:
    """Create a Stripe Customer for a shipper (one per shipper, reused)."""
    return stripe.Customer.create(
        email=email or None,
        name=name or None,
        metadata={k: str(v) for k, v in (metadata or {}).items() if v is not None},
    )


def create_setup_checkout_session(
    *,
    customer_id: str,
    success_url: str,
    cancel_url: str,
    metadata: dict | None = None,
) -> stripe.checkout.Session:
    """Hosted Checkout in ``setup`` mode — collects + saves a card to the customer.

    Uses the same hosted-page pattern as one-off payments so it works on web,
    Expo Go and native dev builds without bundling native Stripe modules. Under
    the hood Stripe creates a SetupIntent and attaches the PaymentMethod to the
    customer for future off-session charges.
    """
    md = {k: str(v) for k, v in (metadata or {}).items() if v is not None}
    return stripe.checkout.Session.create(
        mode="setup",
        customer=customer_id,
        payment_method_types=["card"],
        metadata=md,
        success_url=success_url,
        cancel_url=cancel_url,
    )


def list_payment_methods(customer_id: str) -> list[dict]:
    """Return sanitized saved cards for a customer, marking the default."""
    customer = stripe.Customer.retrieve(customer_id)
    default_pm_id = None
    inv = getattr(customer, "invoice_settings", None)
    if inv and getattr(inv, "default_payment_method", None):
        default_pm_id = inv.default_payment_method
    pms = stripe.PaymentMethod.list(customer=customer_id, type="card")
    out: list[dict] = []
    for pm in pms.data:
        card = pm.card
        out.append({
            "id": pm.id,
            "brand": card.brand,
            "last4": card.last4,
            "exp_month": card.exp_month,
            "exp_year": card.exp_year,
            "is_default": pm.id == default_pm_id,
        })
    # Default card first, then most recently added.
    out.sort(key=lambda c: (not c["is_default"]))
    return out


def set_default_payment_method(customer_id: str, payment_method_id: str) -> None:
    stripe.Customer.modify(
        customer_id,
        invoice_settings={"default_payment_method": payment_method_id},
    )


def detach_payment_method(payment_method_id: str) -> None:
    stripe.PaymentMethod.detach(payment_method_id)


def retrieve_payment_method(payment_method_id: str) -> stripe.PaymentMethod:
    return stripe.PaymentMethod.retrieve(payment_method_id)


def create_offsession_authorization(
    *,
    customer_id: str,
    payment_method_id: str,
    amount_eur: float,
    metadata: dict | None = None,
) -> stripe.PaymentIntent:
    """Authorize a saved card OFF-SESSION with MANUAL capture.

    Creates and confirms a PaymentIntent in a single call. A successful
    authorization returns status ``requires_capture`` (funds held, captured
    later on delivery). May raise ``stripe.error.CardError`` for declines or
    when the issuer demands SCA (decline code ``authentication_required``).
    """
    md = {k: str(v) for k, v in (metadata or {}).items() if v is not None}
    return stripe.PaymentIntent.create(
        amount=to_cents(amount_eur),
        currency="eur",
        customer=customer_id,
        payment_method=payment_method_id,
        payment_method_types=["card"],
        capture_method="manual",
        off_session=True,
        confirm=True,
        metadata=md,
    )

