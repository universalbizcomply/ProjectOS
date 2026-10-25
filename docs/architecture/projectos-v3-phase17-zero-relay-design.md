# ProjectOS V3 — Phase 17 zero-relay continuity — design

**Generated 2026-08-10 13:45 (local)** · Phase `PROJECTOS-V3-RELIABILITY-HARDENING1A` · plan v1.2

This is a design record, not an implementation claim. Nothing in it is proven until the live proof in
§6 runs.

---

## 1. A governance gap that must be settled before closure

**The recorded acceptance criteria for Phase 17 do not mention zero-relay continuity.**

Plan v1.2 lists eight criteria for this phase — adversarial coverage of `core`/`agent`, the Phase-12
seam, crash/interruption/recovery, wrong-project isolation, approval bypass, cleanup and residue, and
reuse (not rebuild) of the accepted `.cjs` adversarial evidence. Crosswalk §5b records the same eight.
Neither records zero-relay session continuity.

The standing gatekeeper directive, by contrast, makes zero-relay **the primary acceptance item** and
forbids closing Phase 17 without a live proof of it.

These cannot both silently govern closure. G4 recomputes against the **plan**, so as things stand the
runtime would permit closure with zero-relay unproven. That is the gap.

**This needs an owner decision, and it is a material scope decision — not something an implementer
may resolve.** The options are to amend plan v1.2's Phase-17 `acceptanceCriteria` to record
zero-relay (which makes the gate mechanical), or to record explicitly that the gatekeeper directive
governs closure over and above the plan (which leaves the gate human). The work below proceeds either
way; only the closure mechanics differ.

## 2. What exists today

- `projectos/launcher/session-launcher.cjs` — a deterministic **planner**. It classifies operations
  (auto-allowed / owner-gated / prohibited), enforces working-directory containment against a trusted
  project→root registry, refuses when production is frozen, and returns
  `REFUSED` / `BLOCKED_AWAITING_OWNER` / `READY_TO_LAUNCH` with `permitted`. It states plainly that it
  **never spawns a process, contacts a provider or writes to disk**.
- `projectos/state/projectos-v3.session.json` — the durable checkpoint, schema-validated with a closed
  property set, already carrying `currentHead`, `phaseId`, `nextSafeAction`, results and the protected
  effect flags.
- `@projectos/agent` `governedContext` — proves project identity, plan membership and dependency
  satisfaction before any write.

**Nothing anywhere spawns a worker.** That separation is deliberate and is the main security property
this design must not destroy.

## 3. The smallest thing that closes the gap

One new component: an **executor** that can start a replacement worker, and *only* under a spec the
existing planner already marked `permitted`.

```
Worker A  ──reaches capacity boundary
          ──finishes smallest safe atomic unit
          ──writes durable checkpoint  (existing session record)
          ──releases checkout ownership
                    │
              ProjectOS executor
                    │  refuses unless: permitted spec, clean tree, reconciled,
                    │  owner not paused, no protected action next, no live owner
                    │
Worker B  ──spawned locally with a RESUME INSTRUCTION, not a task
          ──re-derives repo / branch / plan / phase / head from disk
          ──executes only the stored nextSafeAction
          ──updates the durable record
```

The executor is deliberately dumb. It carries no task description of its own: the only thing it can
hand a new worker is "load the ProjectOS checkpoint at this path and continue". Everything about what
to do next comes from durable state that the runtime wrote, which is what keeps a compromised or
stale prompt from becoming an instruction.

## 4. Why the planner/executor split stays

Today's planner cannot spawn, which means a bug in it cannot start anything. Adding execution to the
planner would collapse that. Instead the executor **consumes** a planner decision and refuses on
anything short of `permitted === true`. The prohibition and owner-gate classifications keep their
existing meaning, so the answer to "could this mechanism deploy to production?" stays "the planner
refuses the spec, so there is nothing to execute".

## 5. Safety properties, and where each is enforced

| | Property | Enforced by |
|---|---|---|
| S1 | one active writer per checkout | ownership lock beside the checkpoint, acquired before spawn |
| S2 | old worker cannot mutate after handoff | lock released on exit; a stale holder fails its next write |
| S3/S4 | intended repository and branch | worker B re-derives both and compares to the checkpoint |
| S5/S6 | active plan and phase | `governedContext` already refuses `WRONG_PROJECT` / membership failures |
| S7 | exact checkpoint | checkpoint names its head; a mismatch fails closed |
| S8 | resumes the stored action, not a recomputed scope | the spawn carries a resume instruction only |
| S9 | protected boundaries survive | the existing gates run in worker B unchanged |
| S10 | no raw secret crosses | the checkpoint schema is closed and secret-scanned |
| S11 | crashed worker cannot be raced | lock has an owner pid and a heartbeat; takeover is explicit |
| S12 | duplicate replacement | idempotent on the lock — second attempt refuses |
| S13 | wrong repo/branch/provider | refused before spawn and re-checked after |
| S14 | stale checkpoint or head mismatch | fails closed |
| S15 | owner pause stops continuation | an owner stop flag is checked immediately before spawn |

S11 and S15 are the ones most likely to be got wrong: a heartbeat that is too eager turns a slow
worker into a duplicated one, and a stop flag read too early leaves a window where the owner's stop is
ignored.

## 6. What acceptance actually requires

A live run in which **Worker A stops, ProjectOS starts Worker B, and no prompt is pasted by anyone**.
Worker B must prove repository, branch, plan, phase and head from disk, perform one small harmless
continuation step, and update the durable record.

Documentation is not acceptance. A checkpoint file is not acceptance. A manually opened replacement
session is not acceptance — that is the exact thing being removed.

## 7. Scope discipline

In scope: the executor, the ownership lock, the resume path, the failure matrix, and the canonical
`core`/`agent` reliability carry-forwards R17-1…R17-8.

Out of scope: general polish, new features, and any change to PolyGo or another product repository —
historical debt there is recorded, not mutated, because this phase has no authority over those repos.
