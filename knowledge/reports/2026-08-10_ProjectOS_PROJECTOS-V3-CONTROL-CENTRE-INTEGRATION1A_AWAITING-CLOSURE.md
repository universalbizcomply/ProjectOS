# ProjectOS V3 — PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A — evidence

**Generated 2026-08-10 13:06:13 (local)**

**Project** ProjectOS · **Phase** PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A (numbered phase 12 of 19)
**Branch** `projectos-v3` · **Status at writing** `awaiting_closure`
**Evidence subject head** `7e65fe5a313e8bc9e6cfacd275dbe08905039368` (pushed, reconciled 0/0, tree clean)
**Active plan** ProjectOS V3 v1.2 · PLAN READY (recomputed by the plan engine)

## What the phase had to prove

That the owner can see and drive real governed execution from one control surface — and that the
surface never claims anything the runtime did not actually do.

## The chain that was exercised

Every load-bearing action below was a real click in the real Tauri window:

```
React Control Centre → Tauri IPC → sidecar → governed command channel
   → @projectos/agent → @projectos/core → durable .projectops records
```

No mocked runtime, no CLI substitute, no injected state. Durable records were READ to corroborate
what the surface claimed; they were never written to manufacture a result.

## Desktop proof matrix

| | Result |
|---|---|
| T1 real Tauri session | PASS — embedded WebDriver on `127.0.0.1:4445`, listener owned by the ProjectOS process, `msedgedriver = 0`, bundled `tauri.localhost` frontend, zero process residue |
| T2 runtime connected | PASS |
| T3 active plan v1.2 from the runtime | PASS |
| T4 PLAN READY recomputed | PASS |
| T5 one action matching the durable status | PASS |
| T6 refresh traverses the real chain | PASS |
| T7 governed write path | PASS — `validating → evidence → awaiting_review → awaiting_closure`, each confirmed in the durable core record |
| T8 / T9 stop & resume per canonical lifecycle | PASS |
| T10 / T11 real governance refusal | PASS — the exact G4 refusal, 9 unmet predicates, shown verbatim; nothing closed |
| T12 disconnect honesty | PASS — daemon killed by parentage; surface stopped claiming Live and reported `RUNTIME_STOPPED` with the next safe action |
| T13 reconnect from durable state | PASS — restart reloaded plan v1.2, recomputed PLAN READY, restored `awaiting_closure` with history intact |
| T14 no optimistic success | PASS |
| T15 awaiting_closure via the real lifecycle | PASS |
| T16 / T17 keyboard operation & focus | PASS with disclosed proportional evidence (below) |
| T18 / T19 native desktop sizes | PASS at 1200×820 and the configured 900×600 minimum |
| T20 responsive | PASS at 1440 / 768 / 390 / 320 |
| T21 no unexplained errors or residue | PASS |

## Two defects this phase found and fixed

**A refused governed command was invisible.** The client resolved as soon as the request was
*dispatched*; the runtime's verdict arrives later as a `governed-result` and nothing consumed it, so
a G4 refusal reached the owner as *"Sent to the runtime."* Now one correlated primitive registers the
result listener **before** dispatch, renders the runtime's lines verbatim, fails on a non-zero code,
times out honestly, ignores foreign correlation IDs and always releases the listener. If the result
channel cannot be opened at all, the command is **not sent** — acting while unable to observe the
outcome is worse than not acting.

**Governed state outlived its connection.** Killing the daemon left the surface reporting
*"Live · Canonical runtime state"* against a runtime that no longer existed. Governed state is a live
claim, so it is now replaced on disconnect with the canonical `RUNTIME_STOPPED` state carrying the
owner's next safe action.

## The final blocker: the runtime could not run git

The gate derives head, cleanliness, reconciliation and ancestry by running git — and the daemon is
launched with a deliberately minimal environment (SystemRoot only, no PATH) so it cannot inherit the
developer's GitHub, Supabase, Vercel, AWS or npm credentials. With no PATH there is no `git`, so
every fact failed closed and G4 refused a phase whose tree was in fact clean and reconciled:
*"the current head could not be established"*.

The hardening is right and stays. What was missing is that a tool the runtime legitimately needs was
never bound for it. The **host** now resolves one absolute `git.exe` under the same guards it already
applies to Node — PATH read as data in the host, never by the child, no current-directory entry, no
relative, UNC or device path, canonical, exact filename, deterministic first match, no shell or
`where.exe` — and passes only that path. `PATH` stays absent from the daemon environment, and no
caller can supply the binding. The sidecar rebinds exactly `git` and **fails closed** with no PATH
fallback, because silently searching for something else named git is how a different executable ends
up deciding whether a phase may close.

Proven live, by the refusal itself shrinking:

| Attempt | Unmet predicates |
|---|---|
| Before any evidence | 9 |
| With the evidence tail, no git | 3 — all of them git-execution failures |
| With the Git capability | **1** — *"substantive paths changed after the evidence subject, so the evidence is stale"* |

That last message can only be produced by successfully running `rev-parse`, `status`, `rev-list`,
`merge-base` and `diff`. The runtime now establishes the real head, a genuinely clean tree and real
0/0 reconciliation — and refuses for the correct reason.

## T16/T17 — what is and is not proven

One genuine run of **real Windows keyboard input** against the real window traversed *Skip to
content → Owner Control → Forge → Owner Chat → Safety & Providers → Projects → Mission Control →
Workflow → Safety Gates → Integrations*, every one showing a visible focus indicator. That run is not
reliably repeatable here: Windows denies foreground activation to a background test worker. Rather
than fail the application for a harness limit or pass on nothing, the native spec **skips with an
explicit reason** when it cannot raise the window.

Repeatable evidence comes from the headed browser using real keyboard input — not scripted focus,
not synthetic events: traversal with focus indicators, and **Enter** on the focused control ran the
real handler. Repeatable native foreground acquisition is carried to Phase 17 as test-harness
reliability work.

## Responsive

The real 9-predicate refusal text, measured in the real styled element:

| Width | Horizontal overflow | Refusal | Touch targets |
|---|---|---|---|
| 1440 | 0px | 4 lines | — |
| 768 | 0px | 6 lines | 44px |
| 390 | 0px | 12 lines | 44px |
| 320 | 0px | 16 lines, not clipped | 44px |

Recovery text visible at every width; zero console errors. Native `minWidth: 900` unchanged.

## Verification

`validate-all` **124 / 124 PASS**, exit 0 · core 178 · agent 77 · control-centre 236 · Rust 143 ·
`cargo check` clean on the default and `webdriver-e2e` graphs, plugin absent from the default graph ·
frontend and sidecar builds clean · secrets, reporter and plan validators PASS · `git diff --check` clean.

**Review:** no `innerHTML`/`dangerouslySetInnerHTML` in the renderer, so runtime refusal text is an
escaped React text node; the governed request carries no role and no identity; G4 source is
byte-unchanged since the accepted `c127380`. 0 unresolved CRITICAL, 0 unresolved HIGH.

## Safety

`productionTouched=false` · `deploymentOccurred=false` · `databaseMutationOccurred=false` ·
`externalSendOccurred=false` · `paymentOccurred=false` · `secretCapabilityUsed=false` ·
`rawSecretStored=false`. **Protected effects: NONE.**

## Decision requested

Closure of this phase under the pre-issued ChatGPT ProjectOS G4 gate, recomputed mechanically by the
runtime. Claude is the implementer and can neither approve nor close.
