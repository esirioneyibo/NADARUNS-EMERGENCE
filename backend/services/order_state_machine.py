"""Canonical order lifecycle state machine for NadaRuns.

This is the single source of truth for valid order status transitions.
Endpoints MUST validate every status change through this module so that
illegal transitions (e.g. jumping from `pending` straight to `delivered`,
or advancing a `cancelled` order) are impossible regardless of the caller.

Design goals:
- Backward compatible: the forward "happy path" mirrors the legacy ADVANCE_FLOW
  so existing clients that call /advance with no explicit target keep working.
- Explicit & exhaustive: every state declares the set of states it may move to.
- Side-effect free: pure functions only. The caller owns DB writes + auditing.
"""

from typing import Optional, Set

# ----- Canonical states -----
PENDING = "pending"
ACCEPTED = "accepted"
ENROUTE_PICKUP = "enroute_pickup"
ARRIVED_PICKUP = "arrived_pickup"
PICKED_UP = "picked_up"
ENROUTE_DROPOFF = "enroute_dropoff"
ARRIVED_DROPOFF = "arrived_dropoff"
DELIVERED = "delivered"
REJECTED = "rejected"
CANCELLED = "cancelled"

ALL_STATES = {
    PENDING, ACCEPTED, ENROUTE_PICKUP, ARRIVED_PICKUP, PICKED_UP,
    ENROUTE_DROPOFF, ARRIVED_DROPOFF, DELIVERED, REJECTED, CANCELLED,
}

# States in which an order is being actively worked by a driver.
ACTIVE_STATES: Set[str] = {
    ACCEPTED, ENROUTE_PICKUP, ARRIVED_PICKUP, PICKED_UP,
    ENROUTE_DROPOFF, ARRIVED_DROPOFF,
}

# States from which no further transition is allowed.
TERMINAL_STATES: Set[str] = {DELIVERED, REJECTED, CANCELLED}

# The happy-path forward flow (used when /advance is called with no target).
# Mirrors the legacy ADVANCE_FLOW to stay backward compatible.
FORWARD_FLOW = {
    ACCEPTED: ENROUTE_PICKUP,
    ENROUTE_PICKUP: ARRIVED_PICKUP,
    ARRIVED_PICKUP: PICKED_UP,
    PICKED_UP: ENROUTE_DROPOFF,
    ENROUTE_DROPOFF: ARRIVED_DROPOFF,
    ARRIVED_DROPOFF: DELIVERED,
}

# Full transition table: source -> set of legal targets.
# A driver may cancel from any active state (cancellation handled with penalty
# rules at the endpoint layer). Pending orders can be accepted, rejected, or
# cancelled (by the shipper).
TRANSITIONS = {
    PENDING: {ACCEPTED, REJECTED, CANCELLED},
    ACCEPTED: {ENROUTE_PICKUP, CANCELLED},
    ENROUTE_PICKUP: {ARRIVED_PICKUP, CANCELLED},
    ARRIVED_PICKUP: {PICKED_UP, CANCELLED},
    PICKED_UP: {ENROUTE_DROPOFF, CANCELLED},
    ENROUTE_DROPOFF: {ARRIVED_DROPOFF, CANCELLED},
    ARRIVED_DROPOFF: {DELIVERED},
    DELIVERED: set(),
    REJECTED: set(),
    CANCELLED: set(),
}


class InvalidTransition(Exception):
    """Raised when a requested status change is not permitted."""

    def __init__(self, current: str, target: Optional[str]):
        self.current = current
        self.target = target
        super().__init__(
            f"Illegal order transition: '{current}' -> '{target}'. "
            f"Allowed from '{current}': {sorted(TRANSITIONS.get(current, set())) or 'none (terminal state)'}"
        )


def next_status(current: str) -> Optional[str]:
    """Return the default next state on the happy path, or None if none."""
    return FORWARD_FLOW.get(current)


def can_transition(current: str, target: str) -> bool:
    """True if `current` -> `target` is a legal transition."""
    return target in TRANSITIONS.get(current, set())


def resolve_target(current: str, requested: Optional[str] = None) -> str:
    """Resolve and validate the target state.

    If `requested` is None, falls back to the forward-flow next state.
    Raises InvalidTransition if there is no valid target or the requested
    transition is not allowed.
    """
    target = requested or next_status(current)
    if target is None:
        raise InvalidTransition(current, None)
    if not can_transition(current, target):
        raise InvalidTransition(current, target)
    return target


def is_active(status: str) -> bool:
    return status in ACTIVE_STATES


def is_terminal(status: str) -> bool:
    return status in TERMINAL_STATES
