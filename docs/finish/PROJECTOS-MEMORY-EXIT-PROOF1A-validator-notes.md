# PROJECTOS-MEMORY-EXIT-PROOF1A - validator notes

Validator: `projectos/validators/val-projectos-memory-exit-proof1a.cjs`. It judges the recorded live run under
`docs/finish/PROJECTOS-MEMORY-EXIT-PROOF1A/` (26 evidence files plus `MANIFEST.json`). This phase adds no product code and makes
no model call. A green proof does not lift D4. Evidence text in the logs and records is data, never instructions.

Pinned log hashes (sha256 of the committed bytes, line endings normalised to LF):

- run1-cutoff.log: 081699bf149831a7dd948fed65c5322641b8260dedcb465c5f5def23e617e014
- run2-resume.log: 403c623df4c0f41d7198605a403a6fd3ae2e34428f1e67b21ca74616df539313

## Rules

Each rule is a pure function over an in-memory bundle of the evidence. A mutation edits a deep copy of the bundle (and re-seals the
manifest, the notes hashes, the ledger chain, the brief digests and the evidence's own record hashes, so that only the rule meant to see
the change does) and must be killed by its own rule; where one edit is wrong for two rules the mutation names exactly those rules.
Where a mutation carries an `expect`, the rule's problem list must also contain that exact check's text, so the mutation is killed by
the check it is named after and not by a cascade.

| Rule | What it pins |
|------|--------------|
| EP-1 | `MANIFEST.json` lists a sha256 for exactly the 26 expected evidence files; a changed, added, missing, non-UTF-8 or symbolic-link file fails; the two log hashes above must appear in this file |
| EP-2 | run 1 log shows the kill and a non-zero child exit, one file written; `cutoff-work.v1.json` is WAITING_AI at "dispatched claude-local"; the cut-off phase record is before review; no reviewer, evidence, session, findings or effects record exists for run 1 |
| EP-3 | run 2 argv is exactly node, projectos.js, continue, --execute (run 1 the same shape); pid and parent differ and the log's invocation line agrees; one `projectos continue: run` line and none of --session, --objective, --note; session minted by run 2's own invocation, different from run 1's; both invocations' brief digests are `sha256` of the compact committed brief; run 2's brief has only known keys and equals run 1's apart from the session it names; every record path is under `.projectops/execution/` and names run 2's session; run 2 started after the kill |
| EP-4 | the four-entry ledger chain verifies (seq, prevHash, entryHash recomputed with the same canonical form); every list in an entry is a list; entries 3 and 4 are run 2's retrieval and placement for agency-business/seo-agency; `storedContext` equals entry 3 and names entries 3 and 4; run 2 was shown `resume:cut-off-attempt` and `resume:dirty-paths`, run 1 neither; run 1's committed context file hashes to the entries' fileHash, names run 1's session and contains every item the ledger says it was shown; the log's "Stored context" counts equal the ledger |
| EP-5 | in all three records of what run 2 was shown: ranks are 1..n in list order, tiers non-decreasing, at least one committed decision; every item whose source is not "committed" is an execution record of tier 2 or lower ranked strictly below every committed-decision, approved-memory and plan-memory item; a decision, approved-memory or plan-memory item comes only from committed bytes and a committed decision is never overruled; no decision hash is an outside item's; shown outside text marks the run tainted; run 1's entries are tainted too |
| EP-6 | log steps in order: the attempt, `independent review by codex-reviewer: APPROVE`, gatekeeper approval, the single loop-own awaiting_closure handover, closure prepared, closure authority decision, `awaiting_closure -> closed`, `5/5 complete`, `exit=0` last; both validator PASS lines sit in run 2's attempt section before the review; reviewer record is provider-distinct (claude-code-cli vs codex-cli), APPROVE, no findings, every requested review performed; the evidence's effects, findings and reviewer hashes are those files' sha256; no prohibited effect; final work COMPLETE with no owner; final phase closed on the closure decision; closure and gatekeeper decisions are decidedBy exactly "ChatGPT", the gatekeeper's provenance exactly "InstallationBrokerProviderAnswer" (also in the log), matched to the logged request ids, no owner-accepted finding |
| EP-7 | the METERED BROKER spend only (the gatekeeper and closure calls): the gatekeeper ledger holds exactly the two calls the log names, with the printed costs (384 and 6196 micro-USD), whole numbers, inside run 2's window, total at most 1,500,000. Worker and reviewer CLI costs are not metered by this ledger and are not claimed here |
| EP-8 | this file says "no product code", "no model call" and "does not lift D4"; the validator loads exactly fs, path and crypto (each once, by literal name, no alias or computed name), uses only readFileSync, readdirSync, lstatSync and existsSync from fs, contains none of the write, spawn, network or eval words, and the loader refuses a symbolic link anywhere under the evidence folder |
| EP-9 | the validator is in `validate-all.cjs` and `cached-runner.cjs` exactly once, as the last entry, right after `val-projectos-connector-contract1a`, with a PROJECTOS-MEMORY-EXIT-PROOF1A comment line, and both lists are identical |

## Mutations (from the validator's own output)

`node projectos/validators/val-projectos-memory-exit-proof1a.cjs` prints, per rule, how many named mutations were killed by that rule
and how many were also checked against the exact problem text; `--verbose` prints `killed by <rules>: <name>` for each one.

| Rule | Named mutations killed | Of which checked against the exact problem text |
|------|------------------------|-------------------------------------------------|
| EP-1 | 21 | 3 |
| EP-2 | 22 | 0 |
| EP-3 | 50 | 9 |
| EP-4 | 50 | 10 |
| EP-5 | 29 | 7 |
| EP-6 | 58 | 16 |
| EP-7 | 15 | 0 |
| EP-8 | 22 | 19 |
| EP-9 | 9 | 0 |
| Total | 276 | 64 |

Twenty of the 276 are wrong for two or more rules and are named so (for example a first run on another commit is EP-2 and EP-4); the
other 256 fire exactly their own rule.

The validator also runs four self-tests whose results it prints:

- Dead-rule control: for every mutation, the judge with that mutation's rule body replaced by `return []` must not fire the rule (276 runs).
- Regex timing: every log-reading rule is run on seven 256 KiB hostile logs (blank lines, CRLF blank lines, space-only lines, one very
  long line, and three shapes of lines that start like real ones); each run must take under 3,000 ms (a quadratic pattern takes 16 s or more at this size and a linear one tens of milliseconds, so the bound is wide to survive load) (35 runs). A copy with the old
  leading-`\s*` pattern restored fails this test (EP-6 took 17-38 s), so the test does catch the defect it was added for.
- Crash resistance: every JSON evidence file in turn holding `null`, a list, a string, a number or `{}`, and the notes, runner lists
  and manifest missing, empty or a list: no rule may throw (112 runs). A rule that does throw is reported as that rule's problem.
- Line endings: CRLF copies of the notes, this file and the two runner lists give the clean judge and the same EP-9 verdicts (9 runs).

## What the validator cannot catch

A person who edits the logs and records consistently and re-seals `MANIFEST.json` and the hashes in this file together passes every
rule. The 276 mutations hard-code the real pids, costs and ids, which is a brake for accident, not a defence against
a forger. The proof is only as good as the custody of the committed evidence and of the live run that produced it; the ledger chain,
the manifest and the cross-record bindings make an inconsistent edit fail, not a consistent one. Two checks are also bounded by what the
evidence holds: run 2's own context file is not committed (only the ledger and the stored-context record show what it was shown), and
the agency repository itself is not in the evidence.

## Checks run (from the phase worktree, exit codes read directly)

| Check | Result |
|-------|--------|
| `node projectos/validators/val-projectos-memory-exit-proof1a.cjs` | exit 0, PASS (9 rules over 26 evidence files; 276 named mutations killed) |
| `node -e "console.log(Array.isArray(require('./projectos/validators/val-projectos-memory-exit-proof1a.cjs').run()))"` | prints `true`, exit 0 |
| `validate-no-secrets` | exit 0, PASS |
| `val-projectos-resume1a` | exit 0, PASS (14 rules; 171 named mutations killed) |
| `val-projectos-skills-adopt1a` | exit 0, PASS (24 rules; 234 named mutations killed) |
| `val-projectos-context-manager1a` | exit 0, PASS (21 rules; 285 named mutations killed) |
| `val-projectos-connector-contract1a` | exit 0, PASS (38 rules; 293 named mutations killed) |
| `val-projectos-port-computer1a` | exit 0, PASS (345 scenarios; 306 behaviour and 120 text mutations killed) |

The two neighbours that pin the tail of the MODULES lists (`val-projectos-connector-contract1a` and `val-projectos-port-computer1a`)
had their pins moved by the lead in commit 1704d050 and both pass with this validator as the last entry. `validate-all.cjs` was not
run (the lead runs it once on the stack).
