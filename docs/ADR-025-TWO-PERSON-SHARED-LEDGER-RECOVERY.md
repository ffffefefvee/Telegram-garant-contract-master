# ADR-025: Two-person shared-ledger recovery

Date: 2026-09-21

Status: accepted for the unmatched TON deposit ledger; other recovery paths remain gated

## Decision

The former one-call `match` and `ignore` mutations are removed. An unmatched
deposit can now be resolved only by this sequence:

1. A super-admin with a fresh IdP assertion containing
   `garant:admin:recovery` creates a short-lived request.
2. The request stores an immutable action, target, reason, deposit version and,
   for a match, a hash of the payment state.
3. A different super-admin, using a different IdP session, approves it before
   expiry. The ordinary payment reconciliation path runs first.
4. PostgreSQL locks the request, deposit and payment, checks the captured state,
   then writes the credit/resolution, single-use terminal request and required
   audit event in one transaction.

The database permits only one pending request per deposit. Terminal requests
are immutable. Expired requests are durably closed before replacement, and a
pending request can be cancelled without touching the deposit or payment.

There is no force-apply route. Self-approval, same-session approval, missing
scope, stale state, replay, expiry, asset mismatch and ineligible payment state
fail closed. Repeating approval after a committed match only re-invokes the
idempotent normal settlement check; it does not post another manual credit.

The legacy HTTP routes for one-person deal force-complete/force-cancel,
administrator payment refund, self-service payment refund and funding
deadline extension are also removed. Their underlying code is not an approved
recovery interface and is unreachable from controllers until a reconciled
  two-person intent is designed for each operation.

The pre-existing native-TON manual-review requeue follows the same identity
policy. Its requests now store the requester/approver IdP credential and
session IDs, immutable intent hash, five-minute expiry and cancellation
metadata. Approval requires a different super-admin and a different IdP
session carrying `garant:admin:recovery`; expiry is persisted and audited.
Bounded backfill requires the same recovery scope and still cannot rewrite a
cursor or scan a stopped/terminal watch. A PostgreSQL trigger makes the native
intent and every terminal request immutable, and a partial unique index allows
only one pending request per event.

## Consequences

- Operators need two separately enrolled eligible IdP identities and sessions.
- Audit persistence failure rolls back request creation, cancellation or
  execution.
- External IdP lifecycle drills and PostgreSQL concurrency evidence are still
  required before this control is production evidence.
- This ADR covers unmatched-deposit matching and native-TON manual-review
  replay. Phase 6 remains blocked until any remaining Polygon/shared-ledger
  path is inventoried and external two-identity/concurrency drills are run.
- Jetton cursor rewind and stopped-application requeue are wired service
  primitives but currently have no HTTP controller or runtime caller. They
  must remain unexposed until an equivalent IdP-bound two-person request model
  replaces their single `actorId` inputs.
