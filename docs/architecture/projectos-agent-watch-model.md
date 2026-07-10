# ProjectOS Bridge — Agent Watch Model (design)

> The local Agent is the automation engine. It watches the bridge folders and reacts by
> validating, inspecting git, packaging evidence and appending events. It never writes
> business code and never makes owner decisions.

## 1. What it watches

Per project, under `.projectops/bridge/`:

| Watch target | Trigger | Reaction |
|--------------|---------|----------|
| `prompts/*.json` (new) | new prompt from ChatGPT | validate schema -> promote to `inbox/` -> append `PROMPT_READY` -> alert Control Center / open VS Code |
| working tree (`git status/diff`) | files changed during `IMPLEMENTING` | append `FILES_CHANGED` with the changed-file list (paths only) |
| `outbox/*.json` (new) | Claude drafted a report/evidence | schema-validate -> move to `reports/` / `evidence/` -> append `REPORT_CREATED` / `EVIDENCE_CREATED` |
| validator run markers | validators started/finished | append `VALIDATION_STARTED` / `VALIDATION_COMPLETED` with pass/fail |
| `approvals/decision.json` (new) | ChatGPT/owner decision arrived | update `state.json` phase status; if approved gate -> allow the gated step |

Implementation options (design): a polling loop (safe, simple, cross-platform) or a
filesystem watcher (`chokidar`/`inotify`). Poll interval configurable; default 1s local.

## 2. The Agent loop (pseudocode)

```
loop:
  for each project with .projectops/bridge:
    drain outbox -> reports/ + evidence/ (schema-checked)
    detect new prompts -> inbox/ + PROMPT_READY
    if phase status == IMPLEMENTING:
      diff = git status --porcelain
      if diff changed since last: append FILES_CHANGED(paths)
    if a validator result appeared: append VALIDATION_COMPLETED(result)
    if report + evidence present and validators pass: append REVIEW_READY
    scan all new artifacts for secret patterns + forbidden actions
      -> if hit: append SAFETY_VIOLATION_DETECTED + block
    recompute state.json, worker-status.json
    push redacted projection to cloud (if configured)
  sleep(interval)
```

All appends go through the single events writer (advisory lock). All reactions are
idempotent (keyed on artifact hash / event seq).

## 3. Git inspection (read-only)

- `git status --porcelain`, `git diff --stat`, `git rev-parse --abbrev-ref HEAD`,
  `git remote get-url origin`. **Read-only.** The Agent never `add`/`commit`/`push`.
- Commit/push happen only after `COMMIT_APPROVED` / `PUSH_APPROVED` events exist, and even
  then are performed by the CLI/owner, not silently by the watcher.

## 4. Risk + evidence

- On `FILES_CHANGED` and before `REVIEW_READY`, the Agent classifies each declared action
  via the Core risk engine (`classifyAction`) and updates `risk-register.json`.
- It packages `evidence-pack.json`: branch, HEAD, changed files, validator results,
  confirmations, risks — all with secrets redacted.

## 5. Hard boundaries

The Agent MUST NOT: write business/product code; make owner decisions; bypass approvals;
expose secrets; run production/deploy/DB/send/payment commands; force push. Any such
attempt observed in an artifact -> `SAFETY_VIOLATION_DETECTED` + block, never execute.

## 6. Relationship to the shipped CLI

The current `projectos` CLI (`projectos/agent`) already does the read-only, local, pure
pieces (status/phase/approve/report + git parse). The watch model is the **daemon** form of
the same capabilities: same governance, same Core, plus folder watching + event appends.
Designing it here; not building the daemon in this phase.
