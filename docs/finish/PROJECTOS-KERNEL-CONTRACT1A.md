# PROJECTOS-KERNEL-CONTRACT1A — kernel contract ADR

**Phase:** PROJECTOS-KERNEL-CONTRACT1A, phase 10 of 16 of plan v1.17 (PLANDEC-5fb44adb067b3d368f744369,
activation `04bcd4a`), V4 Stage 1.4.
**Route:** owner-direct closure, under the owner's grant: "You have full authority" and "You are
running on Admin mode, continue work without me." No gatekeeper closure ruling was obtained, and none
is claimed.

## Delivered
| Commit | Content |
|---|---|
| `19396c8` | `docs/adr/ADR-K1-kernel-contract.md` revision 1; `docs/04_TRD.md` §5 pointer |
| `900114e` | Revision 2: class and grant separated; action registry; envelope lineage, `actor` and `budget` |
| `0608b64` | Revision 3: provider-spend grant; intent-derived idempotency key; stop judged by the executor; P6 never grantable |
| `aa1353b` | Revision 3.1: intent-scoped key; expiring provider-spend grant (target); "in person" evidence |

Docs only. There are no source, validator, schema or record changes, matching the phase exclusions.

## Acceptance criteria
1. **Every envelope field names its source of truth and whether it exists today:** met (ADR §2, 14
   fields).
2. **Every class maps to an existing gate or names the gap, and real sends and payments stay
   protected:** met (ADR §3–§4).
   - Grants are mapped to `ownerOnlyActions.ts:56,71,80-86,113-120` and `closureAuthority.ts:92`.
   - Sends, payments and deployment are P5.
   - P4 has no grant until Stage 5.3.
3. **Independent architecture review with findings resolved or recorded:** met.
   - Reviewer: Agency `software-architect` (AMBER; guardrail "ADRs stay Proposed; only the owner
     marks one Accepted"), corpus `ad9264e3`, dispatched through the governed `agency-specialist`
     route.
   - Round 1: CONCERNS, 5 HIGH / 4 MEDIUM.
   - Round 2: 6 resolved, 3 partial, 3 new (2 HIGH / 1 MEDIUM).
   - Round 3: **APPROVE**, with 2 MEDIUM / 1 LOW, all fixed in revision 3.1.
   - Every finding was accepted. None was rejected.

## Verification
- **Checked by the lead before acting:** `rollback` is declared only at `permissions.ts:27,36`. The
  closure delegation is a separate path, `CLOSURE_DECISION_COMMIT_SCOPE` at `closureAuthority.ts:92`.
  The broker needs both the receipt and the allowlist (PROJECTOS-COMPLETION1A ECC SECURITY review).
- `validate-no-secrets`: PASS at `aa1353b`.
- The quality row was appended to `C:\dev\_tools\agency-workforce\history.tsv`: 18 found, 18
  confirmed, 0 false positives, 168.9 s measured.

## Carried forward
- **ADR-K1 stays Proposed until the owner marks it Accepted** (specialist guardrail and owner rule).
- **Open item for PROJECTOS-KERNEL-ROLE-REVIEW1A:** verify by code scan that the agent has no deploy,
  send or merge path.
- **The action registry, envelope fields and rules R1–R7 are design.** Their code lands in the
  ROLE-REVIEW, COST-CAP and PLATFORM-STOP phases and in Stage 2.
