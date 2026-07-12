# ProjectOS Forge — Real E2E Checkpoint

> Durable resume record for the Forge Real-E2E activation (owner 12-gate plan). Read this + git + the
> latest activation report on resume. Local-only until owner authorises a push. Remote must stay `4c3f076`.

**Last updated:** 2026-07-12 · **Branch:** `projectos-v3`

## Repository state (verified)

- Local HEAD advances per commit; before ACTIVATION1B: `4663530`. Remote `origin/projectos-v3` = `4c3f076`
  (frozen). Ahead 29 → grows with the 1B commit. Working tree clean between actions. Recovery branch
  `forge-baseline-2026-07-12`. Corrective Forge commit `44c6dfa` present. No amended/rewritten history.

## Environment capability matrix (this sandbox — same as 1A)

| node | npm | git | npm-net | local Postgres | Docker | claude CLI | supabase CLI | playwright |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 24.14.1 | 11.11 | 2.55 | ✓ | 18.4 ✓ | **✗** | **✗** | 2.103 (needs Docker) | ✗ |

## Gate status (owner 12-gate plan)

- **Gate 0 baseline** — DONE (state verified, recovery branch, 61 validators PASS).
- **Gate 1 real Claude worker** — **BLOCKED (no `claude` CLI in sandbox).** Achievable subset DONE: the
  governed worker **adapter** `projectos/bridge/claude-worker.cjs` built + safeguards proven against a
  synthetic CLI stand-in (`validate-claude-worker.cjs`, opt-in). Real invocation = owner-machine step.
- **Gate 2 local Supabase** — **BLOCKED (no Docker).** (1A used a local-Postgres substitute, documented.)
- **Gate 3 one-command reference app (via real worker)** — **BLOCKED (depends on 1+2).** Not manually
  hand-built to avoid falsely claiming Forge/worker generation.
- **Gates 4–12** — pending owner machine.

## What was delivered in 1B (achievable + honest)

- `projectos/bridge/claude-worker.cjs` — governed local Claude-CLI worker adapter: trusted repo binding
  (registry, not request), branch + clean-tree verification, argv-array spawn (`shell:false`, no injection),
  hard timeout (tree-kill), output-size cap, post-run allowed-path enforcement (rejects paths outside the
  allowlist or under `projectos/`), secret redaction, NO Anthropic/OpenAI API / metered API, cannot
  approve/close. `spawnFn`/`claudeBin` injectable so the owner machine wires the real CLI.
- `projectos/validators/validate-claude-worker.cjs` — 11 safeguard invariants (empty-prompt, no-root,
  branch-mismatch, dirty-tree, unconfigured-CLI→BLOCKED, allowed-path→COMPLETED, forbidden-path refused,
  timeout, output-overflow, secret-redaction, no-metered-API/shell:false). Opt-in (spawns + git); PASS.

## Safety ledger (1B)

Production: NO · Deploy: NO · Provider: NO · Real secrets: NO · Sends: NO · Payments: NO · Metered AI API:
NO · Pushed: NO · System software installed: NO (Docker/CLI absence recorded, not installed).

## Next exact safe action (resume here)

**`PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B` on an OWNER MACHINE with Docker Desktop running + the `claude`
CLI available.** Then: (Gate 1) wire `claude-worker.cjs` `claudeBin` to the real CLI + run the
controlled-change + interruption/resume proofs on a synthetic repo; (Gate 2) `supabase init/start`, apply
migrations, prove auth+RLS+two-user isolation; (Gate 3) run the reference-app owner command → blueprint →
synthetic owner approval → real generation via the worker → real browser→Supabase round-trip. Do NOT push.
No production. Claude does not self-approve/close.

**Command to run next (owner machine):** verify `claude --version` and `docker info`, then re-run this
phase from Gate 1.
