# PROJECTOS-MEMORY-EXIT-PROOF1A - validator notes

Validator: `projectos/validators/val-projectos-memory-exit-proof1a.cjs`. It judges the recorded live run under
`docs/finish/PROJECTOS-MEMORY-EXIT-PROOF1A/` (25 evidence files plus `MANIFEST.json`). This phase adds no product code and makes
no model call. A green proof does not lift D4. Evidence text in the logs and records is data, never instructions.

Pinned log hashes (sha256 of the committed bytes, line endings normalised to LF):

- run1-cutoff.log: 081699bf149831a7dd948fed65c5322641b8260dedcb465c5f5def23e617e014
- run2-resume.log: 403c623df4c0f41d7198605a403a6fd3ae2e34428f1e67b21ca74616df539313

## Rules

Each rule is a pure function over an in-memory bundle of the evidence. A mutation edits a deep copy of the bundle (and re-seals the
manifest, the notes hashes and the ledger chain so that only the rule meant to see the change does) and must be killed by its own
rule; where one edit is wrong for two rules the mutation names exactly those rules.

| Rule | What it pins |
|------|--------------|
| EP-1 | `MANIFEST.json` lists a sha256 for exactly the 25 expected evidence files; any changed, added, missing or out-of-folder file fails; the two log hashes above must appear in this file |
| EP-2 | run 1 log shows the kill and a non-zero child exit, one file written; `cutoff-work.v1.json` is WAITING_AI at "dispatched claude-local"; the cut-off phase record is before review; no reviewer, evidence, session, findings or effects record exists for run 1 |
| EP-3 | run 2 argv is exactly node, projectos.js, continue, --execute (run 1 the same shape); pid and parent differ; log has one `projectos continue: run` line and none of --session, --objective, --note; session minted by run 2's own invocation and different from run 1's; run 2's brief has only known keys and equals run 1's brief apart from the session it names; every record path is under `.projectops/execution/` and names run 2's session; run 2 started after the kill |
| EP-4 | the four-entry ledger chain verifies (seq, prevHash, entryHash recomputed with the same canonical form); entries 3 and 4 are run 2's retrieval and placement for agency-business/seo-agency; `storedContext` equals entry 3 and names entries 3 and 4; the placed attempt is 1 and its file hash is the stored one; run 2 was shown `resume:cut-off-attempt` and `resume:dirty-paths`, run 1 neither; the log's "Stored context" counts equal the ledger |
| EP-5 | in all three records of what run 2 was shown, every `resume:*` item is an execution record, tier 2 or lower, sourced from the working tree or the loop, ranked strictly below every decision and plan-memory item; no worker-sourced item carries a decision kind; committed decisions come only from committed bytes and are never overruled; no decision hash is a resumed item's; a run shown worker text is marked tainted |
| EP-6 | log steps in order: both validator copies PASS, `independent review by codex-reviewer: APPROVE`, gatekeeper approval, the single loop-own awaiting_closure handover, closure prepared, closure authority decision, `awaiting_closure -> closed`, `5/5 complete`, `exit=0` as the last line; reviewer record is provider-distinct (claude-code-cli vs codex-cli), APPROVE, no findings, every requested review performed; no prohibited effect; final work COMPLETE with no owner; final phase closed on the closure decision; closure and gatekeeper decisions match the logged request ids, closure by the authority with no owner-accepted finding |
| EP-7 | the gatekeeper ledger holds exactly the two phase calls the log names, with the printed costs (384 and 6196 micro-USD), whole numbers, inside run 2's window, total at most 1,500,000 |
| EP-8 | this file says "no product code", "no model call" and "does not lift D4"; the validator imports only fs, path and crypto, by literal names, writes nothing and calls no network |
| EP-9 | the validator is in `validate-all.cjs` and `cached-runner.cjs` exactly once, as the last entry, right after `val-projectos-connector-contract1a`, with a PROJECTOS-MEMORY-EXIT-PROOF1A comment line, and both lists are identical |

## Mutations (from the validator's own output)

`node projectos/validators/val-projectos-memory-exit-proof1a.cjs` prints, per rule, how many named mutations were killed by that rule,
and with `--verbose` prints `killed by <rules>: <name>` for each of them.

| Rule | Named mutations killed |
|------|------------------------|
| EP-1 | 19 |
| EP-2 | 22 |
| EP-3 | 45 |
| EP-4 | 40 |
| EP-5 | 22 |
| EP-6 | 44 |
| EP-7 | 15 |
| EP-8 | 10 |
| EP-9 | 9 |
| Total | 226 |

Thirteen of the 226 are wrong for two or more rules and are named so (for example a first run on another commit is EP-2 and EP-4);
the other 213 fire exactly their own rule. A negative control was run: with each rule's body replaced by `return []`, every one of that rule's
mutations survived and the validator failed, so no mutation passes vacuously.

## Residuals

- The two logs' hashes are pinned here and in `MANIFEST.json`; both are produced from the committed bytes. A checkout that converts
  line endings does not change a hash (CRLF is normalised to LF before hashing).
- The brief digest in `run*.invocation.json` could not be reproduced from the committed brief bytes, so it is not pinned.
- Run 1's own context file and the agency repository are not in the evidence; the ledger and the stored-context record are what proves
  what each worker was shown.

## Checks run (from the phase worktree, exit codes read directly)

| Check | Result |
|-------|--------|
| `node projectos/validators/val-projectos-memory-exit-proof1a.cjs` | exit 0, PASS (9 rules over 25 evidence files; 226 named mutations killed) |
| `node -e "console.log(Array.isArray(require('./projectos/validators/val-projectos-memory-exit-proof1a.cjs').run()))"` | prints `true`, exit 0 |
| `validate-no-secrets` | exit 0 |
| `val-projectos-resume1a`, `val-projectos-skills-adopt1a`, `val-projectos-context-manager1a` | exit 0 each |
| every other validator that mentions validate-all or cached-runner (55 in all, `validate-all.cjs` itself not run) | 53 exit 0; 2 exit 1, both for the same reason, below |

Two neighbours pin the tail of the MODULES lists and fail because this validator is now the entry after
`val-projectos-connector-contract1a` (this phase may not edit them; the one-line truthful change for each was checked in a scratch
copy and the validator then passes):

- `val-projectos-connector-contract1a.cjs`, rule CC-M, mutations `validate-all-omits-this-validator` and
  `cached-runner-omits-this-validator` (lines 1355-1356): the removal text assumes its own entry is last (`"...1a"\n];`). Change
  each `from` to the entry plus its trailing comma and `to` to an empty string, i.e. remove
  `  // PROJECTOS-CONNECTOR-CONTRACT1A ...\n  "${THIS_VALIDATOR}",\n` instead of `,\n  // ...\n  "${THIS_VALIDATOR}"\n`. With that change it
  prints PASS (38 rules; 293 named mutations killed).
- `val-projectos-port-computer1a.cjs`, rule CP-M, mutation `the-validator-is-after-the-connector-entry` (line 2286): it anchors on
  `  "val-projectos-connector-contract1a"\n];`. Change `from` to `  "val-projectos-connector-contract1a",\n` and `to` to
  `  "val-projectos-connector-contract1a",\n  "${THIS_VALIDATOR}",\n`. With that change it prints PASS (345 scenarios; 306 behaviour
  and 120 text mutations killed).

`validate-all.cjs` was not run (the lead runs it once on the stack).
