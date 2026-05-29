"""NadaRuns backend service layer.

Houses production-grade business logic extracted from the monolithic server:
- order_state_machine: canonical order lifecycle + transition validation
- audit: append-only order event log (audit trail)
- idempotency: idempotency-key dedup for unsafe writes
"""
