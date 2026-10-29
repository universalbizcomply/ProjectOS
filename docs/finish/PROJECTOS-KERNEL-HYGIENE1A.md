# PROJECTOS-KERNEL-HYGIENE1A — validator registry and toolchain pins

**Phase:** PROJECTOS-KERNEL-HYGIENE1A, plan v1.18 (activation `e1e1e72`), V4 Stage 1.
**Branch:** `projectos-kernel-hygiene1a`, isolated worktree, cut from `e1e1e72`. Not pushed, not merged.
**Exclusion honoured:** no validator rule was changed. Every validator file is either run by
`validate-all` or listed there as retired with a recorded reason.

## What was missing

At `e1e1e72`, `projectos/validators/` held 155 validator files (`val-*.cjs`, `validate-*.cjs`, not counting
`validate-all.cjs`). `validate-all` ran 147 of them. Eight were never run by the suite, including the two
added in plan v1.17. Nothing stopped this from happening again: a new validator only ran if someone
remembered to register it.

Engines are not validators. `plan-discovery-engine.cjs` and `plan-governance-engine.cjs` expose no
`run()`, and they do not match the `val-` / `validate-` prefix, which is how `validate-all` tells
validators apart. `lib/` is not scanned.

## Delivered

### Registered (5): now run by `validate-all`

| Validator | Standalone result | Why it was not running |
|---|---|---|
| `val-host-state-activation-wiring-10h` | PASS | §10H landed without registration (§10I was registered) |
| `validate-v2-closure-evidence` | PASS | Its header says it is run explicitly. Nothing stops it running in the suite: static file checks |
| `validate-wsl2-provider` | PASS | Opt-in pure-helper regression. Needs no live WSL |
| `val-projectos-kernel-role-review1a` | PASS (37 named mutations killed) | Added in v1.17, never registered |
| `val-projectos-kernel-cost-cap1a` | PASS (26 named mutations killed) | Added in v1.17, never registered |

### Retired (3): listed in `validate-all` `RETIRED`, each with its reason

| Validator | Reason recorded |
|---|---|
| `val-watchdog-conformance` | Per-product tool. It needs `--target <product checkout>` and checks that product's vendored watchdog core, not this repository. Without a target, `run()` returns an error by design. Run it with `npm run watchdog:conformance -- --target <checkout>`. |
| `validate-claude-worker` | Opt-in owner-machine security evidence (its own header: NOT part of `npm run validate`). Its `run()` is async, and the synchronous runner cannot await it: a Promise would read as a vacuous PASS. It also **fails inv50** when run standalone, because its self-pin still expects `mkdtempSync(path.join(os.tmpdir` after `1d25cc8` moved it to `lib/scratch.cjs`. That fix belongs in the validator file, which is outside this phase's writePaths. |
| `validate-speed-validation-cache` | **Blocked, not superseded.** It needs `projectos/speed/cached-runner.cjs` to carry the exact `validate-all` MODULES list. That list has drifted: 143 entries at `e1e1e72`, against 147 then and 152 now. Register it in the phase that resyncs `cached-runner.cjs`, which is outside this phase's writePaths. |

### Registry check (new, in `validate-all`)

`validate-all` now lists the directory before reporting. Each of these fails the run, and each also
stops `--record-evidence` from writing a record:
- a validator file that is neither registered nor retired;
- a file that is both registered and retired;
- a retired name with no file behind it;
- a retirement with no reason.

The registry is not a module, so it adds no result entry, and `registeredModuleCount` still equals
`results.length`. I exercised it in a stubbed scratch copy:
- clean tree: passes;
- an unregistered new validator: fails;
- a retired file removed: fails;
- `--record-evidence` with an incomplete registry: no record is written.

### Carry-forward: `val-projectos-kernel-platform-stop1a`

This validator does not exist on this branch, so it was not invented here. **When it lands, it must be
added to `MODULES`.** The registry check enforces this: until it is registered, or retired with a
reason, `validate-all` fails.

### Toolchain pins

- **Node.** `"engines": { "node": ">=24.14.1 <25" }` was added to `./package.json`,
  `projectos/core/package.json` and `projectos/agent/package.json`. It matches docs/04_TRD.md §1 (Node
  24.14.1 recorded). No dependency changed. `npm ci` still succeeds in core and agent with the existing
  lockfiles.
- **Rust.** A new `./rust-toolchain.toml` pins channel `1.96.1` (docs/04_TRD.md §1: rustc 1.96.1
  recorded). It uses profile `minimal` with components `rustfmt` and `clippy`. That matches the stable
  install's components, minus rust-docs.
  - The pin names a distinct rustup toolchain, so `1.96.1-x86_64-pc-windows-msvc` had to be installed
    alongside `stable`. Both are rustc 1.96.1 (31fca3adb).
  - Without it, `cargo` inside the repo fails ("toolchain is not installed"), or auto-installs it if
    auto-install is on.
  - Once installed, `cargo --version` and `rustc --version` report 1.96.1 in `projectos/host/core`,
    `projectos/host/service-host`, `projectos/host/windows-local-ipc` and
    `projectos/control-center/src-tauri`, with the toolchain overridden by this file.
  - Any other machine needs `rustup toolchain install 1.96.1 --profile minimal -c rustfmt -c clippy`, or
    auto-install.

## Verification

- `node projectos/validators/validate-all.cjs`
  - **Before** (owner baseline at `e1e1e72`): 147 registered, 145 PASS, 2 FAIL (`validate-desktop-e2e`,
    `val-cd-b4-sealed-expected-window-facts1a`).
  - **After:** 152 registered, 150 PASS, 2 FAIL, 3 retired.
    - The two failures are the same two as before. `validate-desktop-e2e`: no Control Center production
      bundle. `val-cd-b4-sealed-expected-window-facts1a`: V2 `session_digest` is public.
    - All five newly registered validators PASS in-suite.
    - The registry check reports no problems.
    - **No new failure.**
- `validate-no-secrets` (the phase's required validator): PASS, with this evidence file present.
- `npx vitest run test/loopToolGrants.test.ts` (projectos/agent): 85 of 85 pass. That includes "this
  phase's own approved writePaths become a grant with no refusal", which was failing under v1.17's
  writePaths.
- Core: `npm ci` passed, then `npm run build` (tsc) passed. Agent: `npm ci` passed.
- `git status --short` shows changes only in this phase's writePaths.

## Follow-ups outside this phase's writePaths

1. `projectos/speed/cached-runner.cjs`: resync MODULES with `validate-all`, then register
   `validate-speed-validation-cache`.
2. `projectos/validators/validate-claude-worker.cjs`: update the inv50 self-pin to the `lib/scratch.cjs`
   form. Separately, decide whether async validators should be supported by `validate-all`.
3. `docs/04_TRD.md` §1 still says Node "(no `engines`)". It should name the new range and
   `rust-toolchain.toml`.
4. `validate-v2-closure-evidence.cjs`: its header comment still says it is not run by `validate-all`.
5. `docs/06_Plan.md`: the phase tick, with date, commit and evidence, has not been written.
