# Delta Specification — PROJECTOS-COMPLETION1A ("complete")

**Status:** APPROVED by the owner in Plan Mode on 2026-10-28. Plan v1.16 was activated at
`3448395`. Under the V4 re-sequencing (`06_Plan.md` Stage 0), the key revocation is decoupled from
completion. The agency gatekeeper is disabled only if the key is revoked with no replacement.

**Goal:** close ProjectOS on the definition of done the owner set (plan v1.15 complete, `2baff14`):
- retire the temporary pieces created for the live proofs;
- disable spending once the key is revoked;
- record the completion.

There are **no new features** and no change to how ProjectOS governs.

## Zone 1 — ADDED (new files)

| File | Purpose |
|---|---|
| `docs/00_Baseline_State.md` … `docs/06_Plan.md` | Context architecture (already written; docs only) |
| `docs/changes/delta_spec.md` | This file |
| `.cursorrules` | Mirrors the CLAUDE.md agent rules for Cursor (already written) |
| Root `CLAUDE.md` (local; excluded from git by `.git/info/exclude`) | "Context architecture" section appended, as you instructed. The existing "FIX IT, OR SAY THE FIX" text is unchanged word for word. Already done. |
| `docs/finish/PROJECTOS-COMPLETION1A.md` | Completion record: what was delivered, the owner acts, the carry-forwards, and the owner's completion words quoted verbatim |
| Plan v1.16 records | A one-phase plan, PROJECTOS-COMPLETION1A (source, PLANDEC, activation), with writePaths limited to the MODIFIED files below |
| Closure records for PROJECTOS-COMPLETION1A | Phase record, closure evidence, report, index row, owner-direct decision. Only after the owner says ProjectOS is complete |

**No new tables, components or runtime modules.**

## Zone 2 — MODIFIED (minimal, exact)

| File | Change | Why |
|---|---|---|
| `projectos/security/installation-project-allowlist.json` | Remove the `seo-agency` entry, which is marked TEMPORARY. `projectos` is unchanged. | The entry's own note says remove it when the agency proof is retired. Once the key is revoked, the broker cannot spend for the agency anyway. |
| `projectos/validators/val-projectos-boot-continue1a.cjs` | AG-5 only: the expected allowlist becomes exactly `projectos`. | Keeps the pin truthful after the removal |
| `C:\dev\SEOAgency\.projectops\gatekeeper.json` (agency repo) | `"enabled": false`. The route and transport stay recorded. | No paid call can be attempted without a stored key. Re-enabling is a one-line owner decision. |
| `knowledge/ProjectOS Reports Index.md` | One completion row | Record |

**Order (dependencies):**
1. The owner revokes the key and deletes the stored credential.
2. Allowlist and AG-5 change, in one commit.
3. The agency gatekeeper is disabled.
4. The completion record is written.
5. Owner-direct closure, on the owner's word "complete".

## Zone 3 — PROTECTED (DO NOT TOUCH)

The full list is in `docs/00_Baseline_State.md` §4. In particular:
- **Closure and authority:** `projectos/core/src/closureAuthority.ts`, `closureEligibility.ts`,
  `closureDecision.ts`, `closureTransport.ts`, `ownerOnlyActions.ts`, `permissions.ts`, `phase.ts`;
  `projectos/agent/src/closureGate.ts`, `closureWait.ts`, `commands/closure.ts`, `commands/phase.ts`,
  `commands/run.ts`.
- **Loop and judges:** `projectos/agent/src/loop/**` (workers, pinned validators, verification,
  gatekeeper config, technical continuation, transports).
- **Broker and credentials:** `projectos/security/gatekeeper-transport-broker.cjs`,
  `trust-boundary.json`, `broker.cjs`, `redaction.cjs`; `projectos/credentials/**`;
  `projectos/scripts/projectos-credential-router.cjs`.
- **Governance engines and plans:** `projectos/agent/src/planApproval.ts`, `planDecision.ts`,
  `governanceEngines.ts`; `projectos/validators/plan-*-engine.cjs`; `projectos/schemas/**`.
- **Validators:** every validator except the AG-5 lines named above.
- **Rust host:** all of `projectos/host/**`.
- **Control Center:** all of `projectos/control-center/**`, including the Supabase SQL. The RLS
  weakness is recorded and needs its own owner decision.
- **Watchdog SQL:** `projectos/watchdog/**`.
- **Authority records:** every existing record under `.projectops/` (authority, gates, plan decisions,
  closure decisions, plans, phases, gatekeeper.json, project-config.json), apart from the new
  completion records in Zone 1.
- **Agency repo:** everything except `.projectops/gatekeeper.json` (`site/`, `vendor/`, validators,
  plans, records).

## Impact analysis

- **Behaviour change:** after this, the broker refuses any `seo-agency` request (not allowlisted), and
  the agency gatekeeper is disabled. ProjectOS's own governance is unchanged. ProjectOS itself uses
  the interactive gatekeeper and is unaffected.
- **Risk:** low. Two data lines and one validator assertion; no runtime logic. Reversible by restoring
  one allowlist entry and one boolean.
- **Checks:** `val-projectos-boot-continue1a` (with AG-5 updated), `validate-no-secrets`, agent and
  core suites (no code change, so they are expected unchanged), validate-all (no new failure beyond
  the two known).
- **Reviews:** the ECC SECURITY review of the allowlist change, as an independent reviewer for a
  security-boundary edit.

## Owner actions this delta needs (not done by Claude)

1. Revoke the OpenAI key (platform.openai.com → API keys).
2. Run `npm run credentials -- delete --ref ProjectOS/projectos/development/openai/gatekeeper-api-key`.
3. Say "complete". That word authorises the owner-direct closure of PROJECTOS-COMPLETION1A.
