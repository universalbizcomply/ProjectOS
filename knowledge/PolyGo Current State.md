# PolyGo — Current State

> Current-state summary for the PolyGo project, for ProjectOS Project Knowledge.
> Only sourced/confirmed facts included. Unknowns marked clearly.

## Project identity

- **Name:** PolyGo
- **Type:** Client project (staffing / booking / scheduling platform — based on observed edge functions for offers, assignments, bookings, invoices, job sheets).
- **Governance:** Operates under PROJECT-GOVERNANCE-GATE1A.

## Repo

- `polygonia-apres/polygo`

## Production URL

- https://polygo-jet.vercel.app

## Staging URL

- https://polygo-staging.vercel.app

## Production Supabase ref

- `cefrqofhiqnfrckqpckl`

## Staging Supabase ref

- `trailizzubpgnhygcdou`

> **Do not use:** Old/unused Supabase ref `miprqhrrtqrlulkixmdb` — never use.

## Governance model

- Production is **frozen** unless explicit owner approval.
- Owner approval required for production deploy, production DB mutation, real sends and payment.

## Production freeze status

- **FROZEN** unless explicit owner approval.

## Closed phases summary

- **NOSEND1D-3 — CLOSED.**
  - Final `origin/main` for NOSEND1D-3 closure: `c6022fe`
  - Proof-record commit: `9c7ba0d`
  - Tracker commit: `c6022fe`
  - Closure basis:
    - 6/6 long-tail senders byte-exact deployed to staging from `be332fe`
    - 6/6 `verify_jwt=true`
    - 6/6 unauth / bad-JWT → 401
    - 6/6 routed through no-send wrapper
    - `send-contract-email`, `send-client-form`, `send-job-sheet-email` live-proven
    - All proven rows: `external_delivery=false`, `would_send=false`, suppressed, masked `.invalid` recipient, no raw body/recipient/token/link leak, no provider call, no real email/SMS/payment, 0 residue
    - `send-task-notification` blocked by pre-existing auth/users/profile guard
    - `send-availability-enquiry` and `send-schedule` blocked by pre-existing staging `bookings.venue_id` / `recalculate_booking_totals` drift

## Current technical foundation

- Frontend deployed on Vercel (production + staging).
- Backend on Supabase (production + staging projects).
- Supabase edge functions include a **no-send wrapper** discipline for outbound sender functions (suppress real sends, mask recipients, prevent provider calls).
- Edge auth hardening present (`verify_jwt=true`, unauth/bad-JWT returns 401 on the proven senders).

## Current carry-forward queue

- **STAGING-PARITY-BOOKING-TOTALS1A** — resolve staging `bookings.venue_id` / `recalculate_booking_totals` drift.
- **SEND-TASK-NOTIFICATION-PROOF1A** — prove `send-task-notification` once its pre-existing auth/users/profile guard is addressed.

## Known risks / blockers

- Staging drift on `bookings.venue_id` and `recalculate_booking_totals` blocks `send-availability-enquiry` and `send-schedule` proofs.
- `send-task-notification` blocked by pre-existing auth/users/profile guard.
- Production freeze must be respected; no production action without explicit owner approval.

## Next recommended phases

- STAGING-PARITY-BOOKING-TOTALS1A (carry-forward).
- SEND-TASK-NOTIFICATION-PROOF1A (carry-forward).
- (Sequencing relative to ProjectOS install to be decided by owner/advisor.)

## What ProjectOS should eventually install into PolyGo

- A project-local `.projectops` folder (config + validators + report scaffolding).
- Standardised phase reporter and evidence/proof packs.
- Staging deploy guard.
- Staging drift detector (directly relevant to the booking-totals drift above).
- CI governance gates aligned with the production freeze and gated-action rules.

## Source confidence notes

- Vercel URLs, Supabase refs, repo name, NOSEND1D-3 closure facts and commit hashes: supplied as confirmed facts in the phase brief.
- Project "type" description is inferred from edge-function names referenced in prior session context — treated as indicative, not authoritative.
- No Product Blueprint / SaaS / production work started after NOSEND1D-3 (per phase brief).

## Source discipline

- **Confirmed from owner/project memory:** Repo `polygonia-apres/polygo`; production/staging Vercel URLs; production/staging Supabase refs; old unused ref `miprqhrrtqrlulkixmdb`; production frozen; NOSEND1D-3 CLOSED; closure commits `c6022fe`/`9c7ba0d`; NOSEND1D-3 closure basis; carry-forward queue; no post-NOSEND1D-3 product work.
- **Confirmed from local repo docs:** None read in this phase (no product repo scanned).
- **Not verified:** Live current state of staging/production (not inspected); exact present contents of `bookings.venue_id` / `recalculate_booking_totals` drift; current production deployment hash.
- **Needs source:** Authoritative product description / scope doc for PolyGo; current PolyGo tracker percentage / status snapshot.
