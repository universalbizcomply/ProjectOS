# PROJECTOS-VSCODE1A — VS Code Extension (Evidence Pack)

> **Scope:** A VS Code extension that surfaces the `projectos` CLI (status/plan/plugins/
> report) in the editor. Thin bridge — spawns the CLI, shows output; never edits code or
> runs anything gated. No deploy/DB/network/secrets/push.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-VSCODE1A — roadmap Phase 5, over LOCAL-AGENT1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure owner-gated.
4. **Branch:** projectos-v2-core (local; not pushed).
5. **Package:** `projectos/vscode` — extension manifest (engines.vscode ^1.90, 4 contributed commands) + `src/extension.ts` + tsconfig.
6. **Commands contributed:** `ProjectOS: Status / Execution Plan / Integration Catalog / List Reports` — each runs `projectos <cmd>` in the workspace root via `execFile` and streams output to a "ProjectOS" Output channel; ENOENT is handled with a "build/link the CLI" hint.
7. **Design:** the extension is a viewer over the CLI; all governance (owner-only closure/approval, gates) stays in the core/CLI. No editing, no gated actions.
8. **Typecheck + build:** strict `tsc` (Node16 module res, `@types/vscode` + `@types/node`) — EXIT 0; emits `dist/extension.js`.
9. **Verification limits (honest):** compile-verified only. Launching the extension host / packaging (`vsce`) requires an interactive VS Code and was **not** run headless. Runtime behaviour (command palette → CLI output) needs owner/interactive verification. No unit tests (thin I/O wrapper; logic lives in the CLI which is 99% covered).
10. **Framework validators:** unchanged.
11. **Secrets / external / gated actions:** none.
12. **Rollback:** delete `projectos/vscode/`.
13. **Carry-forward:** package with `vsce` + install to verify runtime; optionally resolve a workspace-local CLI path instead of requiring `projectos` on PATH; add a status-bar item.
14. **Decision needed:** owner/advisor review + closure, and an interactive runtime check when convenient.

## Final status
**PROJECTOS-VSCODE1A — AWAITING-REVIEW.** Extension implemented + compile-verified (dist emitted). Runtime verification is owner/interactive (headless can't launch VS Code). No gated action, no secrets, no push.
