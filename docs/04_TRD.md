# 04 — Technical Requirements (locked stack)

The versions below are **locked**. Changing a major or minor version needs an owner-approved plan
phase. Ranges are the manifest values; resolved versions are the lockfile values.

## 1. Locked stack

| Layer | Package / tool | Manifest | Resolved |
|---|---|---|---|
| Runtime | Node.js | (no `engines`) | 24.14.1 (recorded) |
| Language | `typescript` | ^5.7.2 | 5.9.3 |
| Tests | `vitest`, `@vitest/coverage-v8` | ^2.1.8 | 2.1.9 |
| Node types | `@types/node` | ^22.10.2 | — |
| UI | `react`, `react-dom` | ^18.3.1 | 18.3.1 |
| Bundler | `vite`; `@vitejs/plugin-react`; `esbuild` (pinned) | ^5.4.11; ^4.3.4; 0.21.5 | 5.4.21; —; 0.21.5 |
| Desktop | `@tauri-apps/api`; `@tauri-apps/cli`; `@tauri-apps/plugin-opener`; Rust `tauri` / `tauri-build` | ^2.1.1; ^2.1.0; ^2.2.5; 2 / 2 | 2.11.1; 2.11.4; 2.5.4; 2.11.5 / 2.6.3 |
| Desktop E2E | `webdriverio`, `@wdio/*`; `@wdio/tauri-service` | ^9.30.1; ^1.3.0 | 9.30.1 |
| UI tests | `@testing-library/react`, `@testing-library/dom`, `jsdom` | ^16.1.0, ^10.4.0, ^25.0.1 | — |
| Cloud data | `@supabase/supabase-js` | ^2.47.10 | 2.110.1 |
| Rust host | rustc; crates `windows` 0.61.3, `windows-sys` 0.59, `serde` 1, `serde_json` 1, `thiserror` 1, `sha2` 0.10, `zeroize` 1 | edition 2021 | rustc 1.96.1 (recorded) |
| Watchdog | Deno (typecheck), `node --test` | — | — |

**Approved for later addition (owner, 2026-10-29).** For the Hermes/OpenClaw/OpenBot ports in
`docs/recon/V4_Port_Map.md`. Each is added only when the phase that needs it is built, at an exact
version recorded here at that time, and runs locally with no network service:

| Package | Plain purpose | For | Stage |
|---|---|---|---|
| `sqlite-vec` | Search by meaning over memory and documents (keyword search works without it) | C8, C10 | 3 |
| `cron-parser` | Read schedule expressions such as "every weekday at 9am" | C13 routines | 4 |
| `cel-js` | Check every agent action against written safety rules before it happens | C14 agent computer | 4 |

Owner's answer to "Which may I add when their features are built?": all three.

TypeScript settings: `strict: true` everywhere; target ES2022; module NodeNext (agent, core, daemon)
or ESNext with Bundler resolution and `jsx: react-jsx` (control-center).

## 2. Folder structure (what goes where)

```
projectos/
  agent/        CLI + autonomous loop (src/cli.ts, src/commands/*, src/loop/*, src/loop/transports/*), tests in test/
  core/         pure kernel (no I/O): phase, permissions, owner floor, closure authority/eligibility/transport, gatekeeper contracts
  control-center/ Vite/React renderer (src/), Tauri shell (src-tauri/), Node sidecar (sidecar/), supabase/*.sql, packaging/ (WiX MSI)
  host/         40 Rust crates: ProjectOSHost Windows service, IPC, ACLs, attestation, crypto
  security/     trusted broker, allowlist, trust boundary, redaction
  credentials/  vault, Windows Credential Manager adapter (.cjs + .ps1), operation gate
  validators/   154 validator scripts (+ lib/); validate-all.cjs registers 147
  schemas/      JSON schemas (plan, current state, project config, bridge, evidence, …)
  watchdog/     core, sentinel, sql/ (Postgres migration + tests)
  templates/, examples/, scripts/, bridge/, worker/, session-router/, speed/, state/, forge/, vscode/, dashboard*/
docs/           plans (phase JSON), finish evidence, architecture, and this context set (00–06)
knowledge/      reports and the reports index
.projectops/    governed records (see 05_Schema.md)
```

**Rules for new code:**
- Kernel logic that needs no I/O goes in `core/`.
- I/O goes through the agent's `System` port (`agent/src/system.ts`).
- Every new rule gets a validator pin and a named mutation.
- Tests sit beside their peers in `agent/test/` and `core/test/`.

## 3. Third-party services and executables

| Service | Used for | Access path |
|---|---|---|
| OpenAI Responses API (`POST https://api.openai.com/v1/responses`) | Gatekeeper review and closure questions; plan authoring | **Only** through `projectos/security/gatekeeper-transport-broker.cjs`, run from committed bytes |
| Claude Code CLI | The worker | `agent/src/loop/adapters/claudeCodeCli.ts`; no Anthropic API key used |
| git | All repository facts and commits | `sys.exec('git', …)`; the bound git binary |
| PowerShell + Windows Credential Manager | Credential storage | `credentials/windows-credential-store.ps1` (advapi32 `Cred*`) |
| Supabase | Optional cloud Control Center data and sign-in | `control-center/src/data/supabase.ts` |
| GitHub REST | Watchdog sentinel | `watchdog/sentinel/run-sentinel.ts` |
| Resend | Watchdog email | `watchdog/core/src/email.ts` |

## 4. Security constraints (enforced in code; do not weaken)

1. **The key never enters the agent process.**
   - Resolvers are `unprovisionedResolver`.
   - The broker resolves the key in its own process.
   - Credential input comes only from a hidden TTY prompt (`--value` and piped input are refused).
2. **Who may spend.** Broker calls need all three of:
   - the installation allowlist (projectId, canonical repository, governed root);
   - the phase's committed `gates/<PHASE>.secrets-handling.json` (APPROVE);
   - the committed broker opt-in.
3. **Owner floor.** `ABSOLUTE_OWNER_ONLY` = phase-closure, secrets-handling, payment-or-live-charge.
   Commit and push need a proven technical delegation.
4. **Worker write grants come only from the plan's `writePaths`.** Never granted:
   - `.git*`, `.claude`, `.husky`, `.vscode`, Windows device names;
   - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`;
   - `.projectops/` except `proof/`;
   - directories over validators, governed files, ignored content or package roots;
   - globs, absolute paths, traversal or symlinks.
5. **Judges cannot be rewritten by what they judge.** Validators run from the base commit. A phase copy
   of a granted validator is added, bounded, and guarded against checkout changes.
6. **Authority is read from committed bytes** (`git show HEAD:`): delegation, receipts, gatekeeper
   config, decisions, and the broker's own source.
7. **ProjectOS commits under its own identity** (`ProjectOS implementer`). The owner check refuses
   that identity unless the owner committed the `closure-decision-commit` grant.
8. **Closure decision time.** An in-call `decidedAt` must fall within the question window.
9. **Secrets.** Scrubbed environment for spawned processes; `validate-no-secrets` and key-shape
   validators.
10. **Protected actions always stop for the owner:** production deploy, production DB mutation,
    external sends, payments, credential disclosure or rotation, service install,
    ACL/registry/ProgramData changes, force push, merge, phase closure (unless delegated), and push or
    commit where reserved.

## 5. Kernel contract (V4)

Every operation carries the task envelope and falls into one of six permission classes defined in
`docs/adr/ADR-K1-kernel-contract.md`. Unknown actions default to the protected class; no flag,
setting or model judgement can lower a class.
