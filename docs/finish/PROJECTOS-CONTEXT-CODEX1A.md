# PROJECTOS-CONTEXT-CODEX1A — finish record

Branch `projectos-context-codex1a`, based on `c16af007`. Spec: `docs/changes/delta_spec.md`, "Phase A". Closes residual 6 of
`docs/finish/PROJECTOS-WORKER-CODEX-IMPLEMENTER1A.md`.

## Existing code found (extended, nothing rebuilt)

- `CONTEXT_POINTABLE_KINDS`, `contextPointerPathOf`, `pointerInstruction`, `correctionInstruction`, `BUILT_IN_ADAPTERS` in `adapters/claudeCodeCli.ts`.
- `InstructionBuilders`, the refusal of a brief naming `records.contextPath`, and `start` in `adapters/codexImplementer.ts`.
- The runner gate `CONTEXT_NOT_POINTABLE`, and the place-before / retire-after-in-`finally` order around the adapter call (`runner.ts`, read only).
- `candidateSnapshot` / `scopeBreaches` (`writeScope.ts`, read only, untouched).
- Pins CM-20 (`val-projectos-context-manager1a.cjs`) and WI-3 / WI-9 (`val-projectos-worker-codex-implementer1a.cjs`).

## What changed

- `claudeCodeCli.ts`: `CONTEXT_POINTABLE_KINDS = [CLAUDE_CODE_CLI, CODEX_IMPLEMENTER]`; the registry entry passes `contextPointerPathOf`.
- `codexImplementer.ts`: `InstructionBuilders` gains `contextPointerPathOf` (injected; still no import from the Claude adapter); the refusal is removed;
  both sentences receive `contextPointerPathOf(brief.records.contextPath, root) ?? undefined`, the same call the Claude adapter makes.
- Validators: CM-20 pin and mutation moved to the two-kind list; WI-3 pin changed from "refuses" to "both sentences are given the injected pointer",
  mutation `stored-context-ignored` moved onto the new pin and three mutations added; WI-9 `wired` pin updated.
- Tests: `codexImplementerAdapter.test.ts` (seven rule tests), `loopContext.test.ts` (one loop case with kind `codex-implementer-cli`).

Rule 6, from reading `runner.ts` (not weakened): the loop places the file (`contextRun.place`, line ~1942) BEFORE `adapter.start`, and retires it in a
`finally` AFTER it returns. The Codex adapter takes both snapshots inside `start`, so the file is present and unchanged in both, and `scopeBreaches`
sees no difference for it. A worker that rewrites or deletes it is still a breach (tested), because the file is not in any write grant.

## Rule -> test -> mutation

| Rule | Test (codexImplementerAdapter.test.ts unless noted) | Named mutation (killed by its own rule) |
|---|---|---|
| 1 told where the file is | "rule 1+2" | `stored-context-ignored`, `start-sentence-without-the-pointer` (WI-3) |
| 2 project-relative, under `.projectops/execution/` | "rule 1+2" | `the-pointer-is-not-held-to-the-root` (CM-20, existing) |
| 3 outside the root: no pointer | "rule 3" (three bad paths) | `the-pointer-is-not-held-to-the-root` (CM-20) |
| 4 correction sentence carries it | "rule 4" | `correction-sentence-without-the-pointer` (WI-3) |
| 5 other kinds still refused, before the record | "rule 5"; loopContext "refuses a worker kind that is not told" (existing) | `a-worker-kind-that-is-not-told-is-pointable`, `any-worker-kind-may-be-given-a-file` (CM-20) |
| 6 scope check still runs; context file not a breach | "rule 6" (both snapshots hash it; rewrite/delete still refused); loopContext Codex case | `no-snapshot-before`, `no-snapshot-after`, `breach-not-refused` (WI-4, existing) |
| 7 no import from the Claude adapter | "rule 7" | `adapter-imports-the-claude-adapter` (WI-9, existing); `kind-not-wired` (wired pin now includes the injected function) |
| (regression) the old refusal must not return | — | `stored-context-refused-again` (WI-3) |

## Checks (as run in the worktree)

See the commit report: tsc exit 0; vitest 5 files, 255 tests passed; the five named validators passed
(`worker-codex-implementer1a` 79 mutations killed, `context-manager1a` 285, `kernel-followup1a` 88, `worker-lifecycle-bounded1a` PASS, `validate-no-secrets` PASS);
`kernel-role-review1a` (also reads `claudeCodeCli.ts`) 44 mutations killed. `validate-all` was not run (the lead runs it on the merged stack).

## Residuals

- Fakes only; no live Codex run. A real Codex run was not made, so "told" means the sentence on the command line, not that Codex obeys it.
- Rule 6 is shown with the fake git world and by reading `runner.ts` / `writeScope.ts`; no new real-git test was added (`writeScopeRealGit.test.ts` passes unchanged).
- Codex's workspace-write sandbox lets it read the context file like anything else in the checkout (residual 2 of the implementer finish record stands).
