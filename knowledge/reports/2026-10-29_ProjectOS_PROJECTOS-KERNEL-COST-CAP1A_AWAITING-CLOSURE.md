# PROJECTOS-KERNEL-COST-CAP1A — awaiting closure

**Phase:** PROJECTOS-KERNEL-COST-CAP1A, phase 12 of 16 of plan v1.17
**Closure route:** owner-direct, under the owner's full-authority grant. No gatekeeper closure ruling was obtained, and none is claimed.

## What it did

- A paid provider call that would push a phase past $1.50, the day past $2 or the month past $5 is refused before it is sent.
- The limits and prices come from the committed config only; anything missing, unreadable or malformed is a refusal, never unlimited.
- The Windows Host service's copy of the ledger enforces the same limits.

## Before the Host service is ever started

- Make the Host read the committed config, and align how the Host and the agent label phases.

Full record: `docs/finish/PROJECTOS-KERNEL-COST-CAP1A.md`.
