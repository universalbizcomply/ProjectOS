# PROJECTOS-PROVIDER-ROLES1A — a committed role registry and a read-only roles report (plan 4.2, first slice)

**Phase:** PROJECTOS-PROVIDER-ROLES1A, plan v1.37 (`docs/changes/delta_spec.md`, "Plan v1.37 — PROJECTOS-PROVIDER-ROLES1A").
**Branch:** `projectos-provider-roles1a`, worktree `C:/dev/ProjectOS-worktrees/provider-roles1a`, base `f60dd66c`.
Not pushed, not merged, phase not closed, no phase record created. `docs/06_Plan.md` is not edited.

Selection and recording only. Nothing consults the registry to choose a worker, no network path was added, no credential
is read, and no money rule changed. A registry that parses is not an approval of anything, and the result type has no
field that could say so.

## What the lead needs to know

1. **The agent's `@projectos/core` junction** points at another worktree (`host-review-path1b`), which has no role
   registry. After `npm run -s build` in this worktree's `projectos/core`, the agent typecheck and tests were run
   through an ALIAS to this worktree's `core/dist` (a `vitest.alias.config.ts` and two `tsconfig.alias*.json` files in
   `projectos/agent`, deleted before the commit; the junction was not touched). The plain `npm run build` in the agent
   would fail with TS2305 until the junction sees this core, as after a merge and a core build in the main checkout.
2. **`val-projectos-port-providers1a` needed two edits, not one.** PP-24 was narrowed as the delta says. PP-1 also had to
   list `roleRegistry.ts`: that validator pins the exact file list of the broker directory, and the registry lives there
   (the delta puts it in `core/src/modelBroker/`). The new file is judged under every rule the other 16 are (origin
   mark, purity, no credential words, no second `RateCard`). The agent's `modelBroker/index.ts` keeps its original
   exports on their original line, so the validator's existing barrel mutation still applies.
3. **The registry file is judged on its own text, not by being left off a list.** PP-24 now reads `commands/roles.ts`
   as a pseudo-file: exactly one broker specifier (`../modelBroker/committedConfig.js`), exactly one name
   (`loadCommittedRoleRegistry`), and none of the names that make the broker callable. Every other file keeps the old
   rule. The new validator's own file is excluded from the importer scan the way PP's own is (it quotes imports in its
   mutations and runs nothing).
4. **Test file names.** Both new test files are `modelBroker-roles.test.ts`, because PP-24 treats a test whose name starts
   `modelBroker-` or `modelBroker.` as inside the module.

## Fix round after the ECC review (APPROVE WITH CHANGES, 8 items)

Each item has its test first, and its named mutation in `val-projectos-provider-roles1a.cjs` (now 141) or `val-projectos-port-providers1a.cjs`.

| # | Change | Pinned by |
|---|---|---|
| 1 | The registry requires an implementer (`NO_IMPLEMENTER`). Each capability belongs to one role (`implement` to the implementer, `review` to the reviewer, the three gatekeeper ones to the gatekeeper); a role must carry its own required capability and none that is another's (`CAPABILITY_MISMATCH`). A reviewer whose named worker holds any non-read or ambiguous grant is refused (`REVIEWER_NOT_READ_ONLY`): `KnownRoleWorker` now carries the grants, which the report takes from `argvGrants` of the committed worker args, and the test `agrees with roleBindingProblems on %s` proves the registry and the loop (`roleBindingProblems`) agree on nine grant shapes | core `a role fits its worker and its capabilities`; agent `the registry agrees with the loop...`; validator PR-13 (14 mutations), PR-10 (3 more) |
| 2 | **Not recoverable.** The review's item 2 was lost in the handoff and is not in this document or the delta. Every numbered delta rule was re-read against the code and each has a test and a mutation; none was found unenforced. One gap of the same kind was closed on my own judgement: a hostile `known` (the sources argument) used to be able to throw out of the judge; it is now `BAD_SOURCES`. The lead should compare against the review text | core `text that is not a string, and sources that throw...`; PR-4 `hostile-sources-throw` |
| 3 | Validation never throws: a Proxy (ownKeys, getPrototypeOf, descriptor or get trap throwing, revoked), a throwing getter (refused `ACCESSOR`, never called), a `toJSON` (never called), hostile text, hostile sources and a hostile role name are typed refusals or `null` | core `a hostile object cannot make validation throw` (5 tests); PR-4 `snapshot-throw-not-caught`, `judge-throw-not-caught`, `hostile-sources-throw` (the two outer guards overlap on purpose: each alone survives its mutation, both off are killed by the tests) |
| 4 | Notes refuse C1 controls, DEL, zero-width, bidi marks, overrides and isolates, line and paragraph separators, the BOM and Unicode tag characters (ten cases) | core `notes carry no invisible or reordering characters`; PR-4 `tag-characters-pass-in-notes`, `c1-controls-pass-in-notes`, `bidi-overrides-pass-in-notes`, `control-character-test-off` |
| 5 | A key written twice in the registry text is refused (`DUPLICATE_KEY`), including an escaped spelling of the same key, and the same key in two records is not mistaken for one; the refusal names the key, never a value | core `a key written twice is refused`; PR-4 `duplicate-key-*`, `keys-are-not-remembered` |
| 6 | An oversize registry is `TOO_LARGE` at both bounds: core caps the text at 16384 bytes before it parses, and the report maps a committed file past the 65536-byte git read bound to `TOO_LARGE` rather than `NOT_COMMITTED` | core size test; agent `a committed file over the read bound is TOO_LARGE`; PR-5 `oversize-*` |
| 7 | PP-24 (and the same fence in PR-8) now reads backtick imports, string concatenation, a quoted template part, multi-line and bare imports, and refuses in `commands/roles.ts` any run-time `import(`/`require(` and any re-export. A MISSING `commands/roles.ts` now FAILS PP-24 (before, the code passed it as empty) and PR-8. PP also proves the importer scan on 12 must-find and 4 must-leave samples | PP: `roles-ts-is-missing`, `-loads-the-broker-by-template`, `-concatenates-the-broker-path`, `-builds-the-path-in-a-template`, `-reexports-the-broker-barrel`, `-reexports-the-reader`, `-loads-something-at-run-time` plus the samples; PR-8: the same set, plus `another-command-*` for a file outside |
| 8 | **`agent/test/platformStop.test.ts` was edited in the original build**: one row, `['roles']`, added to the `readOnlyUnderPlatformStop` table so `roles` is classified read-only beside `tenant`, which the "classifies every command" test requires. It is the only change to that file; PR-9 pins the row (`stop-table-row-removed`) | PR-9 |

The registered validator position is unchanged: immediately before `val-projectos-memory-stores1a` in both `validate-all.cjs` and `speed/cached-runner.cjs`.

The new rule ids: **PR-13** (a role fits its capabilities and its worker) is new; PR-4 (hostile input, hidden characters, duplicate keys), PR-5 (read bound), PR-8 (import spellings) and PR-10 (the record is judged by the same capability binding) grew.

**The report, run for real after the round** (`cli.run` with `nodeSystem` against this worktree, not committed): exit 0, the same three roles, so the committed reviewer `claude-reviewer` passes the real read-only grant check against its real committed args.

## Fix round 2 (independent ECC review: APPROVE WITH CHANGES; the 8 earlier items verified fixed)

| Item | Change | Pinned by |
|---|---|---|
| M1 | The registry now knows a worker's KIND. `KnownRoleWorker` carries `canImplement` and `canReview` (required; a source without them is `BAD_SOURCES`). A reviewer whose kind has no review step is refused `WORKER_CANNOT_REVIEW`; an implementer whose kind is never started as one is refused `WORKER_CANNOT_IMPLEMENT`. `roles.ts` fills them with `kindCapabilities(kind)` from the built-in adapter table (`BUILT_IN_ADAPTERS`, read, not edited): `canReview` is `adapter.review !== undefined`; `canImplement` is membership of `[claude-code-cli, codex-implementer-cli]` (the adapters expose no flag for it: `codex-cli`'s `start` refuses). A kind with no adapter, or named like an inherited member, can do neither. The agent test proves the table against each real adapter: it covers every key of `BUILT_IN_ADAPTERS` (a new kind fails it), compares `canReview` with `adapter.review`, and probes each adapter's own `start` against a system that throws on any touch (only `codex-cli` answers with its not-an-implementer refusal) | core `a role names a worker whose kind can do the role` (5 tests); agent `the registry agrees with the adapter table...` (4 tests plus one per kind); PR-13 +9 mutations |
| L1 | `CONTROL_CHARS` also refuses U+00AD, U+061C, U+180E, U+2060-U+206F (word joiner, invisible and deprecated format controls) and U+FFF9-U+FFFB, ten more cases | core notes tests; PR-4 +4 mutations |
| L4 | HEAD is resolved once per reader and validated as a commit id (hex, 40-64); the file is then read with `git show <sha>:./path`, never by the name HEAD, and the report says `Provider roles (read from commit <sha12>)`. A HEAD that moves between the two calls cannot change which bytes are judged. The gatekeeper transport id used by `productionRoleSources` is read by its own reader, so it has its own one resolution (see carry-forwards) | agent `HEAD is resolved once...` (3 tests); PR-5 +4 mutations |
| L6 | The ESC-note agent test now asserts the refusal explicitly (`BAD_NOTES`, no control character printed), and a new test prints an ACCEPTED registry with non-ASCII in a worker id and a note and asserts plain ASCII output (the previous test could never reach the printed note, because the registry refuses ESC). The core Proxy test now uses a Proxy over a plain object whose traps are counted as reached, and asserts exactly `NOT_A_RECORD` | agent and core tests named in the validator's list |
| L8 | The Converge stat below is the real one | this file |
| L9 | The PP importer scan is case-insensitive on `modelBroker` (a Windows file system resolves `../ModelBroker` to the same directory); same flag in PR-8. The by-name exclusion of the module's own directories, tests and the two validator files from the scan is unchanged: it is by path name and is case-sensitive, so a file that spells its own path in another case is not excluded, which fails safe | PP: 3 scan samples, `roles-ts-imports-by-another-case`, `roles-ts-calls-the-broker-by-another-case` |

## Carry-forwards (not fixed in this phase)

- **L2** The cost class is not tied to the role or to the rate card beyond the model name: the rate-card map key is looked up, but `card.model` is not checked against that key.
- **L3** The registry is not cross-checked against `execution.defaultWorkerId` and `execution.reviewerWorkerId`, so it can name a different implementer or reviewer than the loop uses.
- **L5** `known` is read more than once (stateful hostile input could answer differently); only the registry input is snapshotted once. `known` is built by trusted code from committed records.
- The gatekeeper transport id and the registry are read by two readers, each resolving HEAD once; a commit landing between the two could put them at different commits.

## Existing code found

| Found | Where | Used how |
|---|---|---|
| Worker ids, `defaultWorkerId`, `reviewerWorkerId`, and the committed-`execution` check | `agent/src/loop/workers.ts` (PROTECTED): `authorisedWorkers`, `committedExecutionProblems` | **Called, not edited.** The roles report refuses when the working `execution` block differs from the committed one, and takes the worker ids from `authorisedWorkers` |
| The gatekeeper transport, rate cards, and their committed-price check | `agent/src/loop/gatekeeperConfig.ts` (PROTECTED): `loadGatekeeperConfig(sys, root, 'not-needed')` | **Called, not edited.** Its `rateCards` are the committed ones (it refuses a working copy whose pricing differs). The transport id is also read from the committed `gatekeeper.json`, and both must agree |
| `RateCard`, `rateCardProblems` | `core/src/gatekeeperCostLedger.ts` | **Reused.** A metered model must have a rate card the ledger itself accepts; a zero price is `rateCardProblems`' refusal, not a second rule. PP-16 still forbids a second `RateCard` |
| `CommittedRead`, `committedText` | `agent/src/modelBroker/committedConfig.ts` | **Reused.** One reader added beside the two existing ones; it uses the same path judge and the same refusal of a copy with no commit |
| Record validation style (closed key sets, frozen result, refusal as data) | `core/src/modelBroker/providerRegistry.ts` | Followed. This one adds a plain-snapshot step the provider registry does not have (no accessor, symbol key, non-plain object or `__proto__` reaches validation) |
| `git show HEAD:./` with `-C root` and `--no-replace-objects` | `governedContext.ts` (`committedPhaseCap`), `workers.ts` (`committedExecutionProblems`) | Same form. The report adds `isolatedGit` so no user or system git config runs |
| A read-only command and its platform-stop row | `commands/workforce.ts`, `cli.ts` `readOnlyUnderPlatformStop`, `test/platformStop.test.ts` | Shape followed; `roles` is classified read-only beside `tenant` |
| Any validator that refuses a new `.projectops` file, or a closed list of those records | searched `projectos/validators` and `isFoldableRunRecord` (`commands/run.ts`, PROTECTED) | None found. `isFoldableRunRecord` is a whitelist of what a run commits as its own; the registry is an owner-committed file, so it is not folded and the function is untouched |

## The record, and its closed lists

`.projectops/provider-roles.json` (schema 1), committed for this repository from what is really committed:

| Role | Names | Capabilities | Cost |
|---|---|---|---|
| `implementer` | worker `claude-local` (`claude-code-cli`) | `implement` | `unmetered` |
| `reviewer` | worker `claude-reviewer` (`claude-code-cli`, read-only grants) | `review` | `unmetered` |
| `gatekeeper` | transport `openai-primary` (committed `gatekeeper.json`) | `gatekeeper-review`, `plan-authoring`, `closure-question` | `metered`, model `gpt-5.6-terra` (its committed rate card) |

The two CLI workers run on the owner's logins and have no metered price; each `notes` field says so, and that the
reviewer is the same provider as the implementer (recorded as it is in `project-config.json`).

**Closed lists** (`roleRegistry.ts`, pinned by PR-1..PR-3 and agreed with the validator's own copy by PR-10):

- Roles: `implementer`, `reviewer`, `gatekeeper`. A registry may carry any non-empty subset.
- Capabilities: `implement`, `review`, `gatekeeper-review`, `plan-authoring`, `closure-question`. Chosen from what the
  roles do today: a worker implements or reviews (the two kinds the loop already has, `resolveWorker` and
  `resolveReviewer`); the gatekeeper route is asked to decide a gate (`gatekeeper-review`), to draft a plan (brokered
  authoring, `plan-authoring`) and to answer the closure question (`closureTurn.ts`). Nothing else is claimed.
- Cost classes: `unmetered`, `metered` (the latter names a model in the committed gatekeeper rate cards).

Field shapes: a worker role holds `workerId`, `capabilities`, `cost`, `notes`; the gatekeeper holds `transportId`
instead of `workerId`. Anything else is refused: a field named like a key, credential, token, secret, endpoint, URL
or auth header (`CREDENTIAL_FIELD`), or any other unknown field (`UNKNOWN_FIELD`).

## Delivered

| Item | Path |
|---|---|
| Pure registry: parse, validate, `selectForRole` | `projectos/core/src/modelBroker/roleRegistry.ts` |
| Barrel exports | `projectos/core/src/modelBroker/index.ts` |
| Committed-bytes reader for it | `projectos/agent/src/modelBroker/committedConfig.ts` (one function and two types), `agent/src/modelBroker/index.ts` (one export line) |
| The report | `projectos/agent/src/commands/roles.ts`; `projectos/agent/src/cli.ts` (import, help line, dispatch, read-only row) |
| The record | `.projectops/provider-roles.json` |
| Tests, written first | `projectos/core/test/modelBroker-roles.test.ts`, `projectos/agent/test/modelBroker-roles.test.ts`, one row in `projectos/agent/test/platformStop.test.ts` |
| Validator | `projectos/validators/val-projectos-provider-roles1a.cjs`; registered in `validate-all.cjs` and `speed/cached-runner.cjs`, both lists identical, immediately before `val-projectos-memory-stores1a` |
| The fence | `projectos/validators/val-projectos-port-providers1a.cjs` (PP-1 file list, PP-24 narrowed, four new mutations) |

## Rules to tests to mutations

Every rule had its tests written before the code that satisfies them. Each mutation is applied in memory and counts only
when its own rule fires and no other.

| Rule (delta) | Validator | Tests | Named mutations |
|---|---|---|---|
| 1. A role names only a committed worker or the committed gatekeeper transport | PR-1 | core "names only what is already authorised": unknown worker, unknown transport, none committed, a worker role naming a transport, unknown role, empty registry, wrong schema | `worker-not-checked-against-the-config`, `any-transport-accepted`, `route-not-judged`, `worker-role-may-carry-a-transport`, `unknown-role-accepted`, `refused-role-still-an-entry`, `refusals-do-not-stop-the-registry` |
| 2. A metered cost names a committed rate-card model; a zero price is refused | PR-2 | core "a metered cost names a priced model": no card, zero input, zero output, negative, no model, unmetered with a model, unknown class | `unknown-model-accepted`, `zero-price-accepted`, `price-looked-up-by-prototype`, `unmetered-may-name-a-model`, `unknown-cost-class-accepted`, `metered-without-a-model-accepted`, `rate-card-shape-copied` |
| 3. Capabilities from a closed list | PR-3 | core "capabilities come from a closed list": outside the list, empty, duplicate, non-array, a non-string | `capability-list-grows`, `unknown-capability-accepted`, `repeated-capability-accepted`, `empty-capability-list-accepted`, `capabilities-not-judged` |
| 4. A key, credential or endpoint field is refused (and the read is a frozen plain snapshot, size-capped before parsing) | PR-4 | core: ten credential-shaped names with their own code, the same on the top level, in a cost and in the roles map, notes with a URL or key-shaped run, accessor never called, non-plain objects, frozen result, size cap, refusal cap, no value echoed | `key-names-pass`, `address-names-pass`, `credential-name-test-off`, `unknown-names-pass`, `cost-names-unchecked`, `top-names-unchecked`, `accessor-is-read`, `non-plain-object-read`, `symbol-keys-read`, `snapshot-is-not-frozen`, `proto-key-can-reach-the-copy`, `validation-reads-the-raw-input`, `size-judged-after-the-parse`, `size-cap-raised`, `url-in-notes-passes`, `key-shaped-notes-pass`, `reason-quotes-the-field-value`, `unprintable-names-echoed` |
| 5. Committed bytes only; a working-tree-only change is refused; a differing copy is flagged | PR-5 | agent: committed reader (no copy, no commit, bad path, wrong answer kind), report (committed shown, differing copy flagged, missing copy flagged, CRLF and BOM equal, working-tree-only refused, no HEAD refused, git reads only, nothing written) | `reader-ignores-the-commit`, `reader-judges-the-wrong-bytes`, `no-committed-copy-is-not-refused`, `report-reads-the-working-tree`, `replacement-objects-allowed`, `git-reads-run-unisolated`, `head-not-asked`, `differing-working-copy-not-flagged`, `flag-does-not-fail`, `report-shows-the-working-copy` |
| 6. Implementer and reviewer never resolve to one worker | PR-6 | core "never one worker": same worker named, even when unknown; two workers; one role only | `same-worker-passes`, `same-worker-compared-loosely`, `same-worker-never-asked` |
| 7. Selection returns an entry or nothing, never a verdict; a gatekeeper role is awaiting | PR-7 | core "selection returns an entry or nothing": assigned, nothing, awaiting, no verdict keys, no mutation | `selection-gains-a-verdict`, `gatekeeper-reported-as-assigned`, `report-calls-the-gatekeeper-decided`, `report-claims-an-approval`, `unknown-role-name-selected` |
| 8. Only `commands/roles.ts` imports the model broker, and only the registry reader | PR-8 and PP-24 | agent "through the command line" plus the two validators | PR-8: `an-agent-file-imports-the-broker`, `roles-ts-imports-callModel`, `roles-ts-takes-the-broker-config-loader`, `roles-ts-imports-the-whole-barrel`, `another-command-imports-the-broker`, `core-names-the-broker-outside-its-barrel`. PP-24 (in `val-projectos-port-providers1a`): the two existing ones, plus `roles-ts-imports-callmodel`, `roles-ts-takes-the-broker-loader-too`, `roles-ts-imports-the-whole-barrel`, `roles-ts-stops-importing-the-reader` |

Rules the delta did not number but the build needed, each with its own validator rule and mutations: **PR-9** the command is
dispatched, in help, read-only under the platform stop, exported, and the validator is registered immediately before
`val-projectos-memory-stores1a` in both lists (8 mutations); **PR-10** the committed record is judged against the committed
`project-config.json` and `gatekeeper.json` by the validator's own small judge (10 mutations); **PR-11** the registry module is
pure: no `node:` import, clock, timer, network or file, and no import but the rate-card shape (4 mutations);
**PR-12** nothing but the registry, its reader and the report says the registry's names, so no loop code selects from it
(3 mutations).

## Checks, with what was seen

All read from real output on this machine. Other builds were running at the same time, so timing-bound tests were noisy.

| Check | Result |
|---|---|
| core `npm run -s build` | exit 0 |
| `grep -rn "from 'node:" projectos/core/src/modelBroker` | nothing listed (core stays browser-pure; PR-11 and PP-5 also judge it) |
| core `npx vitest run` | 116 files, 5047 tests, all pass. A first run, under load from other builds, had 2 failures: `skills-round1.test.ts` (a 150 ms timing bound; passes alone, 73 of 73) and one I did not identify; the second whole run was clean |
| core `modelBroker-roles.test.ts` | 42 tests pass in the first build; 84 after fix round 2 |
| agent typecheck, **alias run** (`tsc -p tsconfig.alias.json`) | exit 0 |
| agent `typecheck:all`, **alias run** | 1 error: `test/skillLoad.test.ts(128,26)` `sort` on a `readonly string[]`. A file this phase does not touch |
| agent `modelBroker-roles.test.ts`, **alias run** | 18 tests pass in the first build; 42 after fix round 2 |
| agent `platformStop.test.ts`, **alias run** (with the new `roles` row and the "classifies every command" test) | 116 tests pass |
| agent whole suite, **alias run**, once | 136 of 138 files pass; 4303 tests pass, 1 fails, 10 skipped. The two failing files are not this phase's. `tenantSidecar.test.ts` runs the plain `tsc -p tsconfig.json`, which reads the junction's core and so cannot see the new core exports (the same cause the port-providers finish doc records, and it goes green once the junction sees this core). `loopToolGrants.test.ts` "Every plan v1.9 phase carries writePaths" fails on `PROJECTOS-PROPOSAL-DOOR-WIRING1A` (writePath `.gitignore` is a bare filename) in `docs/projectos-finish-phases.json`, committed at `a0138a0f`, which this phase does not touch |
| `val-projectos-provider-roles1a` | PASS (86 named mutations killed in the first build; 141 after fix round 2, see above) |
| `val-projectos-port-providers1a` | PASS (17 real files judged; 225 text and 89 behavioural mutations killed) |
| `val-projectos-kernel-followup1a` | PASS (88 named mutations killed) |
| `validate-no-secrets` | PASS |
| `val-projectos-port-credit1a` | PASS (197 real files judged; 157 fixture and 59 record mutations killed) |
| Stage 3 validators after the registration line: `resume1a` | PASS (14 rules; 171 mutations) |
| `memory-exit-proof1a` | PASS (9 rules over 26 evidence files; 276 mutations) |
| `memory-stores1a` | PASS (198 text and 84 behavioural mutations) |
| `skills-adopt1a` (run once, in the background) | PASS (24 rules; 234 mutations) |
| Validators that read a file this phase touched: `connector-contract1a` | PASS (38 rules; 293 mutations) |
| `context-manager1a` | PASS (21 rules; 285 mutations) |
| `kernel-platform-stop1a` (reads `cli.ts` and `platformStop.test.ts`) | PASS (101 mutations) |
| `port-mcp1a` (reads `cli.ts`) | PASS (281 text and 107 behavioural mutations) |
| `tenant-principal1a` (reads `cli.ts`) | PASS (210 mutations) |
| `worker-codex-implementer1a` | PASS (80 mutations) |
| `memory-provenance1a` | PASS (204 text and 125 behavioural mutations) |
| `validator-scratch-lifecycle1a` | PASS |

`validate-all` was not run, as instructed.

**The report, run for real.** After the commit, `projectos roles` was run through the CLI entry (`cli.run`, `nodeSystem`) against this
worktree, with the real governed context, `authorisedWorkers` and `loadGatekeeperConfig`. A temporary test (not committed) printed:

```text
exit 0
Provider roles (committed at 816e83619749)
  implementer: worker claude-local; capabilities implement; cost unmetered; assigned
  reviewer: worker claude-reviewer; capabilities review; cost unmetered; assigned
  gatekeeper: gatekeeper route openai-primary; capabilities gatekeeper-review, plan-authoring, closure-question; cost metered, model gpt-5.6-terra; awaiting: a decision is not held in this registry
Selection and recording only: nothing consults this registry to choose a worker, and nothing in it is an approval.
```

(Each role also prints its note.) With one trailing space appended to the working copy of the record, the same run printed the
committed report and then `FLAGGED (WORKING_COPY_DIFFERS)`, exit 2; the file was then restored. The hash shown is the commit the
registry file was first committed at; this document was then amended into the same commit.

## Converge

`git diff --stat` against the base, files other than this document. PROTECTED files appear only where the delta permits: the two
registration lines in `validate-all.cjs` and `cached-runner.cjs` (2 added lines each), and `cli.ts` and the validator
`val-projectos-port-providers1a.cjs`, which are in the delta's MODIFIED list. `loop/workers.ts`, `commands/run.ts`,
`loop/gatekeeperConfig.ts`, the trusted broker, `credentialResolver.ts`, `projectos/security/*`, `project-config.json`,
`gatekeeper.json` and every other `.projectops` record are not in the diff.

```text
 .projectops/provider-roles.json                    |  23 +
 projectos/agent/src/cli.ts                         |   6 +
 projectos/agent/src/commands/roles.ts              | 156 ++++
 projectos/agent/src/modelBroker/committedConfig.ts |  28 +
 projectos/agent/src/modelBroker/index.ts           |   4 +-
 projectos/agent/test/modelBroker-roles.test.ts     | 364 ++++++++++
 projectos/agent/test/platformStop.test.ts          |   1 +
 projectos/core/src/modelBroker/index.ts            |  27 +
 projectos/core/src/modelBroker/roleRegistry.ts     | 439 ++++++++++++
 projectos/core/test/modelBroker-roles.test.ts      | 509 ++++++++++++++
 projectos/speed/cached-runner.cjs                  |   2 +
 .../validators/val-projectos-port-providers1a.cjs  | 116 ++-
 .../validators/val-projectos-provider-roles1a.cjs  | 781 +++++++++++++++++++++
 projectos/validators/validate-all.cjs              |   2 +
 14 files changed, 2449 insertions(+), 9 deletions(-)
```

## Residuals and what is not built

- **Nothing chooses a worker from the registry.** `resolveWorker`, `resolveReviewer`, the loop and the gatekeeper turn do
  not read it (PR-12 holds that). The report is the only reader. A later slice would make selection consult it, which
  is a change to PROTECTED `loop/workers.ts` and needs the owner's approval then.
- **The registry names the reviewer and the implementer as the same provider** (both Claude Code CLI), as
  `project-config.json` already records (`providerDistinct=false`). The "reviewer of a different provider" the Stage 1 and
  Stage 4 exit proofs need is still a later slice (a second worker kind committed in `project-config.json`, then named here).
- **No price for anything outside the committed gatekeeper rate cards.** A metered role can only name one of those models.
  Prices for other providers wait for the later broker slice, as the owner recorded.
- **The gatekeeper role is a route, not a decision.** It reports `awaiting`. Reading the gatekeeper ledger or decisions to
  say anything more is not built, and would be a change to PROTECTED gatekeeper code.
- **`roles` reads two sources that are not the registry**: the working-tree governed context (`loadGovernedContext`, which
  needs a ready plan) and `loadGatekeeperConfig`. If either refuses, `roles` prints that refusal and stops; a project with no
  gatekeeper prints a note and the registry may then not name one. Their `execution` block and pricing are compared with
  their committed copies by the protected functions themselves.
- **The validator's record check (PR-10) is its own small judge in CommonJS**, because the validator cannot import the
  TypeScript. The closed lists are written twice (code and validator); PR-3 pins the code's, and PR-10 would fail if the
  record used one the validator's copy lacks, but the two copies are not compared by machine. A new capability is therefore
  two edits, which is the point of a closed list.
- **The extra rules PR-9 to PR-12** go beyond the delta's eight. They are about wiring and containment and add no behaviour.
