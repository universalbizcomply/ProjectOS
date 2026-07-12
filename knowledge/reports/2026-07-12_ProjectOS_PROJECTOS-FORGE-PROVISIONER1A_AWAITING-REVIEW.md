# ProjectOS — PROJECTOS-FORGE-PROVISIONER1A (F3) — Phase Evidence

**Programme:** ProjectOS Forge · **Phase F3:** `PROJECTOS-FORGE-PROVISIONER1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** (steps 2–4) — awaiting advisor/owner review + closure. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `d079127…`

---

## 1. Objective

Materialise an F2 file manifest to a **local project directory** and produce a **run plan** — with the
install / migrate / start-server steps **owner-gated and never auto-run**. Writing files is a safe,
reversible, local-only action; anything touching the network or a database routes to owner approval.
Zero-dep (fs+os+path only); no network, no process spawning, no metered API.

## 2. Implementation scope

- `projectos/forge/provisioner.cjs`:
  - `materializeManifest(scaffold, targetRoot, { allowedRoot })` — writes the manifest to disk.
    Path-guarded: the target must resolve **inside** the trusted `allowedRoot`, every file must resolve
    inside the target, and — new after review — **no write may pass through a pre-existing symlinked
    component** (lstat walk) and null-byte paths are rejected. Returns `{ root, written[], count }`.
  - `planProvision(scaffold, { approvalQueue })` — returns a plan: file-write = **auto**; `install-deps`,
    `run-migrations`, `start-dev-server` = **owner-approval**, `executed:false`. Enqueues an approval item
    for the gated run. It NEVER executes anything.
- `projectos/validators/validate-forge-provisioner.cjs` — **10 invariants** (writes to an isolated temp
  dir, cleans up), registered in `validate-all.cjs`.

## 3. Invariants proven (all PASS)

1 materialise writes every file with matching content · 2 deterministic on disk · 3 escaping manifest
path refused · 4 target outside allowedRoot refused · 5 no secret-shaped value written · 6 plan gates
install/migrate/run as owner-approval, file-write auto, executed:false · 7 no execution capability (only
fs/os/path required; no child_process/spawn/exec) · 8 gated run enqueues an approval item · 9 null-byte
path refused · 10 write through a pre-existing symlinked directory refused (best-effort where symlink
privilege exists).

## 4. Review — security (security-reviewer agent)

Lexical traversal defenses confirmed robust and fail-closed against every string-level escape (`../`,
absolute, Windows `..\`, drive-relative, UNC, cross-drive target). **MEDIUM fixed**: the guards were
purely lexical, so a **pre-existing symlink** component could redirect a write outside root (TOCTOU) —
added `assertNoSymlinkEscape` (lstat-walks each segment from the trusted root; refuses any symbolic-link
component, for both the parent chain and the destination) + invariant 10. **LOW fixed**: explicit
null-byte rejection in `assertSafeRelPath` + invariant 9. Confirmed: no execution capability;
`planProvision` returns gated steps as data and never runs them; the provisioner injects no secrets. No
open HIGH/CRITICAL.

## 5. Review — ECC

The one filesystem-touching Forge module writes only inside a trusted root and only the manifest (which
carries no secrets); every network/DB/run action is owner-gated and never auto-run — consistent with the
tiered-autonomy model (auto for safe/reversible/local; gate for risky). No PLAN READY effect. Local-only;
no provider/secret/API/network/spawn. Does not change V3 accounting.

## 6. Tests / validators

- `node projectos/validators/validate-forge-provisioner.cjs` → **PASS** (10 invariants).
- `npm run validate` (full suite, now 53 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 7. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Real secrets: NO ·
AI API: NO · Network: NO · Process spawn: NO. Disk writes: LOCAL, inside a trusted root only (the F3
function's purpose; tested against an isolated temp dir and cleaned up). No external repo / PolyGo touched.

## 8. Next phase

**F4 — Generation Loop**: bounded feature generation into the scaffold's typed slots via the LOCAL Claude
Code worker over the desktop bridge (no API), incremental diffs, per-task budget cap + cost-per-feature
readout, doom-loop detection.

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE (steps 2–4) — AWAITING ADVISOR/OWNER REVIEW + CLOSURE. Not pushed.**
