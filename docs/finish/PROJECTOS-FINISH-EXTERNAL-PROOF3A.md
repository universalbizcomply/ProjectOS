# PROJECTOS-FINISH-EXTERNAL-PROOF3A — evidence

Phase 8 of 8 of plan v1.15. This phase is the live proof of PROJECTOS-FINISH-CONTINUE-INTEGRITY1A
(`e4afff6`). On the SEO & Social Agency project (`C:/dev/SEOAgency`), one phase ran from a **single**
`projectos continue` to closed with no owner act, and was judged by its own new validator copy as well
as the base copy. ProjectOS carried the agency phase: a governed worker, the ChatGPT gatekeeper through
the trusted broker, and ChatGPT as closure authority.

## Setup on the agency (criterion 1)

| Commit | What |
|---|---|
| `623585a`, `3e41b24`, `be91bc0` | Agency plan v1.3: the source, the decision and the activation for SEO-AGENCY-SITE-CHECK2A. It closes the gaps the independent reviews found in EXTERNAL-PROOF2A (D8, D10), with explicit file write paths |
| `d304a2a` | The phase's secrets-handling receipt (owner-only gate) |

As in EXTERNAL-PROOF2A, the lead wrote these commits under the shared `Murad` identity.
- Three carry a `Co-Authored-By: Claude` trailer.
- The plan-decision commit `3e41b24` has none, because the `plan decide` command made it itself.
- They rest on the owner's standing messages: "I have given you full authority", and, on 2026-10-26,
  "What is next? Why aren't you clear of what's next?". The second is a direction to carry on, not an
  approval of this specific plan, and the owner did not see agency plan v1.3.
- None is signed.

## The live run (criterion 2), reported separately from synthetic tests

Installation: ProjectOS `e4afff6`, agent rebuilt. **One invocation, `projectos continue --execute`.**

| Step | What happened | Commit or record |
|---|---|---|
| Worker | Write grant of exactly `validate-site.cjs` and `validate-site.fixtures.cjs`. Attempt 1. **`PASS validator validate-site` and `PASS validator validate-site@phase-copy`**: the base copy and the phase's new copy both judged it (D8 fix live) | session `SEO-AGENCY-SITE-CHECK2A-d304a2a6143c-794f4c6f` |
| Review | `GKREQ-ee540a3bb068645b9f6e3ea1` (gpt-5.6-luna), through the broker: approved continuation | 437 micro-USD |
| Technical commit and push | 10 paths, `ProjectOS implementer` | `6847c53` |
| Run records | Committed and pushed by ProjectOS | `4f3e55b` |
| Closure preparation | Both copies PASS again; 3 closure records committed by ProjectOS | `db485a9` |
| **Carried on in the same call** | "carrying on: projectos closure request …" (D7 fix live) | — |
| Closure question | `CLREQ-ffd510383096aa37c082cf1b` (gpt-5.6-terra), through the broker: **close** at `4f3e55b`; `decidedAt 2026-10-26T10:53:21.900Z` | 5,566 micro-USD |
| Closure decision committed by ProjectOS | The bundle, under the owner's grant: "committed by ProjectOS implementer <projectos-implementer@projectos.invalid>", byte-identical to what was presented (`run7.log`) | `e38f318` |
| Closure and persisted close | `awaiting_closure -> closed`, closed by ChatGPT under the delegation; agency plan 3/3; 3 post-close records | `dde2ead` |

**Result:** the agency tree is clean and `work` equals `origin/work` (0/0).

**Spend:** 6,003 micro-USD for this phase; 19,386 micro-USD ($0.0194) across all three agency phases,
against the $5 hard stop. **Relays: 0. Invocations: 1** (`continue --execute`; a `--dry-run` came first
and ran nothing).

## The hardened validator: better, and still partial

The lead's checks after the close:
- the current `site/` passes;
- the fixtures pass 17/17;
- the validator reads no environment variable: the root override is a `--root` argument, which a clean
  copy passes through;
- three bypasses that EXTERNAL-PROOF2A's reviews found are now refused for their own reason: an unquoted
  external `<img src=https://…>`, a JSON-LD script with an external `src`, and `<base href>`.

**The independent reviews found that the agency phase closed with its own acceptance criteria not fully
met.**
- ECC SECURITY, 2 HIGH:
  - Attribute matching is unanchored and tags split at the first `>`. So `data-src=… src="https://…"`,
    a quoted `>` inside an attribute, and `<script data-type="application/ld+json">` with executable
    content all pass.
  - The `on*=` rule needs a quote, so `<img src=x onerror=alert(1)>` passes.
- ECC SECURITY, MEDIUM: whitespace, entity-encoded schemes and backslashes evade the scheme test;
  `formaction`, `<style>` blocks, SVG `href`, `imagesrcset`, `image-set()` and `javascript:` hrefs are
  unscanned.
- ECC CODE, MEDIUM:
  - an unquoted `type=application/ld+json` escapes the JSON check;
  - the `css-import` fixture trips two rules, so it is not targeted;
  - about 18 rules have no breakage case, so "covers every rule" is unmet;
  - the runner checks only that the message is present, not exactness.

Neither the gate nor ChatGPT caught these. The gate ran both validator copies, but a validator can only
judge what it checks. The phase's only declared review was "Claude self-review" (worker-attested). Then
ChatGPT approved the work and decided closure on that evidence.

## Owner acts (criterion 3)

**For the phase: none, and one `--execute` invocation.** Every commit from the worker's work to the
persisted close is ProjectOS's. The setup was lead-authored under the owner's name, as stated above.

| Proof | Owner acts per phase | Invocations |
|---|---|---|
| MULTIPROJECT1A (disposable) | 1 commit + 2 relays | several |
| EXTERNAL-PROOF1A | 2 (plan approval, closure commit) + one-time credential setup | 2 |
| EXTERNAL-PROOF2A | 0 | 2 (D7) |
| **EXTERNAL-PROOF3A** | **0** | **1** |

## Defects and limitations (criterion 3)

| # | Severity | What | Fix route |
|---|---|---|---|
| D11 | HIGH (agency) | **Work closed with its own acceptance criteria unmet** (above). This is the mechanism working exactly as configured, and the configuration is the gap. The agency plan declares only "Claude self-review", so nothing independent judges the work before ChatGPT. And the gate can only run what the plan names: `validate-site.fixtures.cjs` cannot be a required validator, because a validator name may not contain a dot. | In the agency, a follow-up phase that fixes the reported gaps, with: an independent review in `requiredReviews` (an ECC-style code and security review recorded before the gatekeeper is asked); the fixtures renamed `validate-site-fixtures.cjs` and made a second required validator; and fixtures asserting exactly one targeted error each. In ProjectOS, nothing to change: the plan, not the runtime, chooses the reviews. |
| — | LOW (recurring) | The first run line still says "STOPPED (OWNER_DECISION_REQUIRED) … closure is never continued through", just before the closure route carries on and closes the phase. The wording predates delegated closure. | Reword the awaiting-closure stop line when the route will carry on (`runner.ts` / `programmeContinuation.ts`; separate amendment). |
| — | LOW | The receipt's `decidedAt` (09:28Z, the time of the owner's message) predates its bound commit `be91bc0` (09:53Z); its consent basis includes a direction ("What is next?") rather than an approval. The `dde2ead` commit message says "byte for byte as written", though that commit stamps the decision's `consumedAt`. | Record a receipt write time separately; reword the post-close commit message (`technicalContinuation.ts`). |
| — | LOW | `payment-or-live-charge` stays an owner gate. The phase's real provider spend ($0.006) was funded under the gatekeeper's own controls: the committed commercial approval, the $5 hard stop and the secrets-handling receipt. | As designed; stated so it is not read as a gate bypass. |
| D3, D5, D9 | LOW (recurring) | The hard-coded "did not when it was written" receipt line; dry-run leftovers removed by hand; broker provenance inferred, not recorded (no provider response id). | As recorded. |

No ProjectOS code changed in this phase.

## Carried forward

- **Key rotation.** The owner said the key stays "until this project is completed" and that any
  rotation comes "after ProjectOS project completion". Trigger: the owner declares ProjectOS complete.
  Then revoke the key at OpenAI, delete the stored credential, and disable the agency gatekeeper unless
  a new key is stored.
- **D11:** the agency follow-up phase, with independent review in its plan.
- **Signed commits on authority paths:** the owner's decision.

## Checks

- **Agency at `dde2ead`:**
  - `validate-site` PASS, both copies, in the run and in prepare;
  - fixtures 17/17 (lead-run after the close; not a gate, D11);
  - the three bypass probes refused;
  - tree clean; remote in sync.
- **ProjectOS:** `val-projectos-boot-continue1a`, `validate-current-project-state` and
  `validate-no-secrets` PASS with this document added.

## Reviews

These are the first independent reviews of the agency change; the phase's own review was worker-attested.

- **ECC CODE: APPROVE** the evidence, once corrected, with 0 CRITICAL, 0 HIGH, 4 MEDIUM and 2 LOW.
  - It confirmed one invocation; both copies judged in the run and in prepare; every hash, path count,
    request id, cost and timestamp.
  - Its MEDIUMs are the agency criteria gaps and a trailer misstatement, now corrected.
- **ECC SECURITY: WARNING**, 0 CRITICAL, 2 HIGH, 3 MEDIUM, 3 LOW.
  - It confirmed the continue-to-closed mechanics, the closure chain (`e38f318` exactly the decision
    and ledger, `dde2ead` exactly three records), the broker route, the scoped receipt, no secret in
    any commit or the log, and a validator change with no network, no `child_process`, no environment
    read and temp-only fixture writes.
  - Its HIGHs and MEDIUMs are the agency validator's residual bypasses (D11).
- **Fix round:** the document now discloses all of it. No code was changed: the agency's validator
  fixes belong to the agency follow-up phase. This disclosure round was not re-reviewed.

## Verification commands

    cd C:\dev\SEOAgency; git log --format="%h %an | %s" -8
    cd C:\dev\SEOAgency; node projectos/validators/validate-site.cjs; node projectos/validators/validate-site.fixtures.cjs
    type C:\dev\SEOAgency-sources\run7.log
