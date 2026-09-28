# PROJECTOS-FOUNDATION-GAPS1A — evidence

Plan v1.7 (`plan-b6f70f1ebc656030-b23611e2240f`), its only phase. Branch `projectos-foundation-gaps1a`, activation head
`f4dcfac`, base `e7ccf6d`. Nothing is activated: no Rust source, no Cargo manifest, no sidecar, wire, store, IPC route,
selection or authority change; no provider call, spend or credential.

## Unit one — the Projects screen shows the portfolio summary

The daemon already took a read-only summary of every registered project (`buildGovernedState` per root) and the model
already bound it to the right row by exact project id. The screen threw it away: every project that was not selected
printed one fixed line. Selection is refused while governed work runs, so during a run the owner could see nothing about
any other project.

| Part | Where |
|---|---|
| Render of the summary for a project that is not selected: plan status, accepted/total phases, active phase or none, first blocker or no blockers (further ones counted), owner action, next safe action, liveness | `projectos/control-center/src/ux/ProjectsScreen.tsx` (`DormantSummary`, `blockerText`, `livenessText`) |
| Liveness is exactly the summary's two values: RUNNING → "Running now", UNKNOWN → "Worker status not known"; never idle or stopped | same |
| Unavailable project → "ProjectOS could not read this project" + the daemon's own detail (or "No reason was given"); no blocker, owner or plan line that would read as healthy | same |
| No summary → "Open to see what is happening here" (unchanged) | same |
| Dot colour only from recorded facts (owner action → waiting, blocker → blocked, RUNNING → working); unreadable stays neutral | `stateOfRow` |
| "Needs you" badge also for a non-selected project whose summary records an owner action | `Row` |
| Plain text only: every field a text child; no markup, no link | `DormantSummary` |
| Focused tests (12) | `projectos/control-center/test/projectsScreenSummary.test.tsx` |
| Validator rule 7: the screen must hand `row.summary` to the render (`={row.summary}`), not merely mention it | `projectos/validators/val-projectos-portfolio-read-only1a.cjs` |

## Unit two — where windows-client-admission, and the live IPC graph that reaches it, may be enabled

Accepted placement (host review path closure): `windows-service-identity-proof` defines `windows-client-admission`;
exactly one edge enables it — `windows-local-ipc`'s `windows-live-ipc` feature; exactly two crates enable
`windows-live-ipc` — `projectos/host/service-host` and `projectos/control-center/src-tauri`, both from
`[target.'cfg(windows)'.dependencies]`. Before this phase only comments held it, and nothing pinned who may enable
`windows-live-ipc`: the proof-runner validator pinned dependency names only, build-provenance B6 is a positive pin on
service-host, and `gatekeeper-review-composition` was unpinned.

A Cargo manifest scanner (in `val-windows-service-identity-proof-3kideb.cjs`, shared with
`val-windows-local-ipc-capability-b3.cjs`) enumerates every tracked manifest (`git ls-files`, 42 today), strips TOML
comments outside strings, decodes string escapes, reads every dependency table (plain, dev, build, target-specific,
inline or table form, dotted keys), resolves renamed dependencies by `package`, ignores the source (path/git/registry),
follows `dep/feat` and `dep?/feat` feature entries, and walks feature closures across crates. It fails closed: an
unreadable manifest, a failed enumeration, a `path =` dependency that is absolute or does not land on a tracked manifest
(121 of 121 resolve today), any Cargo workspace or `workspace = true` inheritance (not modelled; none exists), or a scan
that no longer finds the accepted edge and both consumers is an error.

| Rule | Validator |
|---|---|
| `[fg-client-admission-default]` no default feature list reaches it | 3kideb |
| `[fg-client-admission-proof-fixtures]` the proof crate's test-fixtures / consumer-contract graph never reaches it | 3kideb |
| `[fg-client-admission-enable-edge]` the only enable edge is windows-local-ipc `windows-live-ipc` (exactly one found) | 3kideb |
| `[fg-client-admission-ipc-fixtures]` windows-local-ipc test-fixtures never reaches it, by any route | b3 |
| `[fg-live-ipc-consumers]` only service-host and src-tauri enable `windows-live-ipc` (both must be found) | b3 |
| `[fg-manifest-scan]` enumeration, parse, path-closure, workspace, absolute-path and vacuity failures | both |

## Named mutation battery (off-tree)

`C:\dev\ProjectOS-candidate-backups\foundation-gaps1a\tools\mutate_foundation_gaps.cjs`. A kill counts only when the
mutation's own named rule fires (and, for `[fg-manifest-scan]`, its specific cause text), in a fresh process; every file is
restored byte for byte and its sha256 re-verified; created files are removed; `git status` is compared before and after.

| Mutation | Result |
|---|---|
| U1-M0 screen drops the summary render | KILLED by rule 7; focused tests under it: 10 failed, 2 passed |
| U2-M1 `default = ["windows-client-admission"]` in the proof crate | KILLED `[fg-client-admission-default]` |
| U2-M2 client admission added to windows-local-ipc test-fixtures | KILLED `[fg-client-admission-ipc-fixtures]` |
| U2-M3 client admission added to the proof crate test-fixtures | KILLED `[fg-client-admission-proof-fixtures]` |
| U2-M4 a proof-runner feature enabling client admission | KILLED `[fg-client-admission-enable-edge]` |
| U2-M5 composition enables `windows-live-ipc` from a target-specific table | KILLED `[fg-live-ipc-consumers]` |
| U2-M6 renamed alias of windows-local-ipc in dev-dependencies | KILLED `[fg-live-ipc-consumers]` |
| U2-M7 composition feature forwarding `…/windows-live-ipc` | KILLED `[fg-live-ipc-consumers]` |
| U2-M8 table-form target build-dependency, name escaped `windows-live\u002dipc` | KILLED `[fg-live-ipc-consumers]` |
| U2-M9 tracked path edge to an unstaged crate whose default enables client admission | KILLED `[fg-manifest-scan]` "not a tracked manifest" |
| U2-M10 `workspace = true` dependency | KILLED `[fg-manifest-scan]` "inherits from a workspace" |
| U2-M11 `[workspace]` root | KILLED `[fg-manifest-scan]` "declares a Cargo workspace" |
| U2-M12 drive-letter absolute path dependency | KILLED `[fg-manifest-scan]` "is absolute" |
| U2-M13 UNC path dependency | KILLED `[fg-manifest-scan]` "is absolute" |
| N1 control: comment-only mention | clean (no fg error) |
| N2 control: non-live windows-local-ipc feature from a target table | clean (no fg error) |

Result: 14/14 killed by their named rule, 2/2 controls clean, unmutated validators PASS, `git status` unchanged.

## Validation

- Control Center: full suite 66 files, 890/890; focused Projects screen tests 12/12; `npm run typecheck` clean.
- Required validators via `run()`: `val-projectos-portfolio-read-only1a`, `val-windows-service-identity-proof-3kideb`,
  `val-windows-local-ipc-capability-b3`, `validate-no-secrets` — PASS.
- validate-all on the final bytes: 145 registered, 143 PASS, 2 FAIL — exactly the two known historical non-passes,
  messages unchanged from the `8f7c326` baseline: `validate-desktop-e2e` (no built Control Center bundle, environmental)
  and `val-cd-b4-sealed-expected-window-facts1a` (retained sealed-window correction).
- Environment repairs this phase needed (git-ignored, no tracked change): `npm ci` in `projectos/control-center`;
  `npm ci` + `npm run build` in `projectos/bridge/daemon` (the Control Center typecheck resolves
  `@projectos/bridge-daemon` from its `dist`).

## Reviews

| Review | Round | Verdict | Disposition |
|---|---|---|---|
| ECC CODE | 1 | WARN: MEDIUM a path dependency onto an unstaged crate silently ended the transitive walk; LOW rule 7 satisfiable by an inert `={row.summary}` | MEDIUM fixed (path closure, M9); LOW accepted — the 12 render tests are the real coverage |
| ECC SECURITY | 1 | APPROVE (5/5 confirmations); MEDIUM workspace inheritance not modelled | fixed (workspace refused, M10/M11) |
| ECC CODE | 2 (delta) | APPROVE | — |
| ECC SECURITY | 2 (delta) | WARN: MEDIUM absolute/drive/UNC paths failed closed only by string coincidence; suggested case-insensitive matching | absolute refusal made explicit (M12/M13); case-insensitive matching declined — on a case-sensitive file system it would vouch for an untracked `Foo` beside a tracked `foo` |
| ECC SECURITY | 3 (delta) | APPROVE; agreed with declining case-insensitive matching | — |

Security confirmations: no authority widening, no new capability route, no Rust/Cargo behaviour change, coverage
load-bearing, accepted consumers exactly pinned.

## Residuals (stated, not hidden)

- The scan reads tracked manifests; an unstaged crate is reachable only through a tracked edge, and that edge is refused.
- Case-mismatched path spellings fail closed (a spurious refusal, never a false pass); none exist today.
- Cargo workspace inheritance is refused rather than modelled; introducing a workspace needs the scan extended first.
- Rule 7 checks that the summary reaches a render call, not what the render shows; the render tests carry that.
- `projectsModel.ts`'s file header (line 13) still describes dormant rows as "name and repository only"; the file was out
  of this phase's scope and is unchanged — comment-only.
