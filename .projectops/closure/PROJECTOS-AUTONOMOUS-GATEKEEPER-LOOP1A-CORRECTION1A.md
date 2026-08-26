# PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A — Closure Evidence Correction 1A

| | |
|---|---|
| **PHASE** | PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A |
| **STATUS** | Closed — this correction does not reopen or revoke the closure |
| **ORIGINAL EVIDENCE COMMIT** | `126d8a4a80ae596d3d98d44177b5711986841450` |
| **DECISION COMMIT** | `b2d2296644504a173d7343e631fac6599498c279` (decision recorded; not yet consumed at this commit) |
| **CLOSURE-TAIL COMMIT** | `c7082c1e995df60958a4f1d0d093faf27e0cfc7c` (phase set to closed; decision's `consumedAt` recorded here) |
| **EVIDENCE SUBJECT** | `b7bc173afc722f77075702f064a1086a663a512f` |
| **CORRECTED BY** | ChatGPT gatekeeper ruling, 26 August 2026 |

## 1. What the original evidence said

Two notes in the closure evidence at `126d8a4`, and one closely corresponding sentence in the
closure decision at `b2d2296`, describe where the governed loop ran. Note indices below are
zero-based positions in the evidence record's `notes` array, as stored.

Closure evidence, `notes[5]`:

> CHECKS PASS refers to the accepted governed run 6d6e7223e54e-b717ef08, **executed from the
> INSTALLED SIGNED application**: four worker attempts, and on every one of them all four required
> checks passed — validate-all, core-tests, agent-tests, agent-typecheck.

Closure evidence, `notes[10]`:

> WHAT THIS PHASE ACTUALLY PROVED, in one sentence: ProjectOS ran the full governed loop **from the
> installed signed desktop application** — worker, checks, autonomous correction, reviewer request,
> budget check, live OpenAI reviewer, verdict application and owner referral — with no human
> carrying a prompt, report or decision between Claude and ChatGPT.

Closure decision `b2d2296`, in its note. This is the same claim in substance but **not** a verbatim
copy — it says "live reviewer call" where the evidence says "live OpenAI reviewer", and differs in
punctuation:

> What the phase proved is that ProjectOS ran the full governed loop **from the installed signed
> desktop application** - worker, checks, autonomous correction, reviewer request, budget check,
> live reviewer call, verdict application and owner referral - with no human carrying a prompt,
> report or decision between Claude and ChatGPT.

## 2. Why that wording was too broad

"From the installed signed application" reads as a provenance claim over the code that performed the
enumerated behaviour. It is not supported at that scope.

The installed signed trust manifest at
`C:\Program Files\ProjectOS Control Center\runtime-payload\projectos-trust-manifest.json`
covers **exactly two artefacts**:

- `runtime/node.exe` — sha256 `58e74bf02fc5bbacc41dcb8bef089961cd5bddd37830b87784e4fc624d145d1f`
- `daemon/projectos-daemon.mjs` — sha256 `7f7f128a230f74c1c8a26452d19a5df28af1ddac006a45a6dbb7b776cbd1e045`

The ES256 signature under `signingKeyId: projectos-signing-20260812` attests to those two and
nothing else. Throughout this record, "signed" means covered by that manifest; it does not refer to
Authenticode, and no claim is made here about Authenticode status.

**The signed daemon is a single bundle and it does contain agent and core code.** Its headers show
30 `// agent/` modules and 19 `// core/` modules inlined, including `agent/dist/closureGate.js`,
`agent/dist/commands/phase.js`, `core/dist/closureDecision.js` and `core/dist/gatekeeperCostLedger.js`.
What it does **not** contain is the loop executor: searching the bundle for `dist/cli.js`,
`loop/run`, `loop/runner` and `workerRunner` returns zero hits. The bundled agent modules are the
daemon's own command handlers and stores.

So the distinction is not "signed daemon versus unsigned agent code" in general. It is narrower and
more specific: the code that performed the behaviour the notes enumerate — worker orchestration,
check execution, autonomous correction, reviewer request, budget check, verdict application and
owner referral — is not in the signed bundle. It executes from the governed checkout:

    projectos/agent/bin/projectos.js  ->  dist/cli.js

No `projectos.js` exists anywhere under the install root.

This is deliberate architecture, not an accident. The installed daemon's `agentCliPath()` resolves
`systemRoot()` plus `projectos/agent/bin/projectos.js` first, falling back to a payload-relative
path (`<daemon dir>/../../agent/bin/projectos.js`) that does not exist in this build.
`startGovernedRun` then spawns `process.execPath` against that script with the governed root as cwd.

The accepted run's invocation record shows exactly that: the packaged
`runtime\node.exe` running `C:\dev\ProjectOS\projectos\agent\bin\projectos.js` with
`cwd: C:\dev\ProjectOS`. This is not unique to that run — **eleven** invocation records for this
phase under `.projectops/execution/` carry that same argv shape and cwd, spanning
2026-08-25T22:40:34Z to 2026-08-26T10:59:44Z. The pattern is the norm for this phase, not a one-off.

The wording is also inconsistent with the same document's own stated standard. On `headedProofPass`
the evidence explicitly refuses to let an adjacent proof stand for the claimed one — recording that
the installed-desktop UI Automation proof "is a different thing and is not claimed as headed browser
proof" — and then makes precisely that substitution here.

## 3. Exact corrected interpretation

**The installed signed ProjectOS application launched the governed loop against the governed
ProjectOS checkout.**

Both components that performed the launch are manifest-covered: the spawning code
(`daemon/projectos-daemon.mjs`) and the spawned image (`runtime/node.exe`). The launch attribution
is therefore accurate.

The worker, checks, autonomous correction, reviewer request, budget check, verdict application and
related agent execution ran through the working-tree ProjectOS agent bundle
(`projectos/agent/bin/projectos.js` to `dist/cli.js`). **That execution chain was not established as
being covered by the installed signed trust manifest.**

Both sentences together are the authoritative statement. Neither stands alone.

## 4. What the phase DID prove

- autonomous orchestration
- worker execution
- required checks
- autonomous correction
- reviewer request
- budget control
- live reviewer result
- verdict application
- owner referral
- no manual prompt, report or decision relay between Claude and ChatGPT

Each of these is a claim about **behaviour observed**, not about the provenance of the code that
produced it.

## 5. What the phase DID NOT prove

- signed provenance of the code performing the behaviour listed in section 4

## 6. Why the phase remains validly closed

The phase's objective is the autonomous gatekeeper loop, not signed provenance of the code
performing it. Every item in section 4 stands on its own evidence and is unaffected by this
correction. The evidence subject `b7bc173` was pushed and reconciled with the expected remote before
the decision was taken; required validation passed from a genuinely clean tree at that subject with
131 registered modules, 131 PASS and 0 FAIL; both required reviews are complete; and there were zero
unresolved CRITICAL or HIGH findings **against the phase's objective** at the time of closure.

All 17 G4 predicates were reported satisfied by the canonical eligibility check. One qualification
belongs on that statement rather than being left implicit: as recorded in the carry-forward below,
G4-11 is currently vacuous, so its PASS was not a meaningful observation. The phase's
protected-effects position rests instead on the accepted run's own effects record, which is
independent of G4-11 and shows all six flags false.

**This is a correction of provenance SCOPE, not evidence that the agent bundle was compromised.**
Nothing here asserts or implies that the working-tree agent code was tampered with or is unsafe;
the point is only that its provenance was never established by the signature, and the evidence
should not have implied that it was. This is a statement about provenance, and it is deliberately
not a general assurance about the correctness of every module involved — the G4-11 carry-forward
below records one governance predicate that does behave wrongly, and that finding stands on its own
terms. Equally, nothing here casts doubt on the installed signed application itself: the two
artefacts the manifest covers are signed exactly as claimed.

## 7. Historical bytes remain untouched

Commits `126d8a4` and `b2d2296` are unchanged. Nothing was amended, rebased, force-pushed or
rewritten; the original claim has not been deleted or edited; `evidenceSubjectHead` is unchanged;
and the consumed closure decision is exactly as the closure machinery spent it, with its
`consumedAt` marker of `2026-08-26T16:38:20.851Z` recorded in the closure-tail commit `c7082c1`.
This correction is additive and auditable: the original wording and this correction both remain
readable in the repository, so a reader can see precisely what was claimed, what was wrong with it,
and what the corrected claim is.

## 8. Scope of this correction

This correction supersedes **only** the signed-provenance wording quoted in section 1 — the phrases
"executed from the INSTALLED SIGNED application" and "from the installed signed desktop
application". Where those phrases appear in the closure evidence or the closure decision, the
statement in section 3 is authoritative.

Because history is not being rewritten, the superseded wording remains readable at `126d8a4` and
`b2d2296` with no marker on those records pointing here. A reader who encounters either record
without this correction will not be alerted to it. That is an accepted consequence of the additive
approach, recorded here rather than left to be discovered.

## 9. Everything else stands

All other accepted closure evidence for this phase remains unchanged and in force unless separately
corrected later. In particular the check results, the validator run record, the review completeness
and the `headedProofPass: null` record are unaffected by this correction. The protected-effects
attestation likewise stands on the accepted run's own effects record, subject to the G4-11
qualification in section 6 and the carry-forward below.

---

## Carry-forward recorded with this correction

### G4-11 — protected-effects predicate

| | |
|---|---|
| **SEVERITY** | HIGH |
| **CLASSIFICATION** | GOVERNANCE CARRY-FORWARD |

**Finding.** The protected-effects closure predicate resolves a fixed
`projectos/state/projectos-v3.session.json` path from the earlier V3 programme, does not bind to the
current programme's real effects record, and fails open where the expected paths are absent.

**Impact.** A future post-V3 closure could receive a misleading protected-effects PASS if this
predicate is relied upon as the authoritative observation.

**Current closure impact: NO INVALIDATION.** For this phase the accepted run has separate effects
evidence recording `productionTouched` false, `deploymentOccurred` false,
`databaseMutationOccurred` false, `externalSendOccurred` false, `paymentOccurred` false and
`rawSecretStored` false.

**Constraint.** G4-11 must be fixed **before** it is relied upon to close any future phase capable
of protected production effects. It is deliberately not fixed in this correction workstream.

### Other carry-forward, retained and not fixed here

- **GK-CF-009** — MEDIUM
- **GK-CF-010** — MEDIUM
- **GK-CF-011** — LOW
- `validate-no-secrets` does not currently scan `.projectops/`
- Broad unanchored `*secret*` / `*token*` ignore patterns can potentially hide governance records
  whose names match those patterns
