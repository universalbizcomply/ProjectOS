# PROJECTOS-KERNEL-CODEX-UNC1A — Codex reviewer: the UNC tripwire reads a quoted escape as a path

**Phase:** PROJECTOS-KERNEL-CODEX-UNC1A, plan v1.23 (activation `f3f2a9e`, decision
`PLANDEC-0bee6eda1f827c7079de926c`). Owner answers it rests on, verbatim: "Yes, run it (Recommended)" and
"Accept tripwires (Recommended)" (2026-10-29); standing grant "You have full authority" (2026-10-28).
**Branch:** `projectos-autonomy-bootstrap1a` (worktree `host-review-path1b`).
**Exclusions honoured:** no owner gate, closure predicate or `ownerOnlyActions` changed; no other tripwire
narrowed (home, `.codex`, `..`, POSIX home, absolute paths, fetch/decode, credential-shaped reply unchanged).

## What was wrong

The exit proof's first run (agency `SEO-AGENCY-SITE-CHECK3A`, 2026-10-30 09:30) stopped with:

> the reviewer 'codex-reviewer' attempted tools it was denied, so it may have been steered by the candidate

The command was not recorded anywhere. A traced re-run of the same adapter path (`codexReviewArgv`,
`readCodexEvents`, the loop's own `reviewInstruction`) against the same candidate, with the live Codex CLI
0.165.0, showed one denial, and it was a false positive. The reviewer piped a Node probe script into `node`
through a PowerShell here-string, to try the candidate validator on odd `Expires` values. The script held the
JavaScript string `"\\nExpires: …"`. The old rule, `/(^|[\s'"=(])(\\\\|\/\/)[^\s\\/]/`, read the quote
followed by `\\n` as the UNC path `\\nExpires:`. Nothing left the checkout.

A denial ends the run on the owner, so this false positive alone would defeat the zero-owner-act exit proof.

The second run-1 suspect ("the worker did not create `site/.well-known/security.txt`") was **not a
defect**: the file existed with the four required fields, the run's evidence lists it, and `validate-site`
plus its 25 fixtures pass. The earlier listing that showed the folder empty was wrong.

## Delivered

`UNC_PATH` (`projectos/agent/src/loop/adapters/codexCli.ts`) now matches a UNC lead (`\\` or `//`, after
start, whitespace, a quote, `=` or `(`) followed by one of:

| Branch | Shape | Denies | Leaves alone |
|---|---|---|---|
| 1 | any host, ONE separator, a path character | `\\host\share`, `//host/share`, `\\?\UNC\…`, `\\.\pipe\…`, `\\localhost\c$\…` | `"\\nExpires: …"` (host then a space), `net view \\localhost` (bare host) |
| 2 | a host of 2+ characters, or the device prefix `?` / `.`, then TWO OR MORE separators | `\\localhost\\c$`, `//localhost//c$`, `\\localhost\/c$`, `\\?\\UNC\…`, `//.//UNC/…`, `\\?\\GLOBALROOT\…` | `"\\n\\t"` (one-letter host: an escape pair) |
| 3 | a host computed by `$(` | `\\$(hostname)\c$\…` | — |

Commits: `a78e96c` (fix), `7e5c83b` (review items), `fd2fe55` (recheck item). Tests in
`codexCliAdapter.test.ts`: 10 new denial cases; 6 new non-denial cases, one of them the exact command the exit
proof's reviewer ran. CX-9 in `val-projectos-kernel-followup1a` pins the regex text; four named mutations (one
per branch, plus the host class) are each killed by CX-9, and CX-9 fires on the pre-fix source.

Replay of the recorded event stream through the built adapter: before the fix 1 denial
(`names a path outside the repository`); after it 0 denials, and the probe is counted as a read.

## Reviews

- **Claude self-review** (lead), including the trace that found the cause.
- **ECC SECURITY review** (independent), using a corpus of about 90 command variants with Windows
  `Test-Path` resolution checks on this host:
  - at `a78e96c`: **APPROVE WITH CHANGES**. MEDIUM 1 (doubled or mixed separators after the host resolve on
    Windows and passed, e.g. `\\localhost\\c$\Users\…`) and MEDIUM 2 (a `$(hostname)` host passed) were fixed
    in `7e5c83b`. The reviewer's suggested `[\\/]+` was not taken verbatim, because it would deny the escape
    pair `"\\n\\t"` and bring back the false positive this phase removes; doubled separators count after a
    host of 2+ characters instead.
  - recheck at `7e5c83b` (the one recheck the pace allows): **APPROVE WITH CHANGES**. MEDIUM 1 and 2 CLOSED.
    New MEDIUM: the device hosts `?` and `.` with doubled separators (`\\?\\UNC\…`, `\\?\\GLOBALROOT\…`)
    resolve and passed. Fixed in `fd2fe55` exactly as the reviewer proposed and tested. No further round:
    the change only tightens and is pinned and tested.

## Verification

- Agent: `tsc` and `typecheck:tests` clean; `codexCliAdapter.test.ts` 128/128; full suite 2898/2898.
- `val-projectos-kernel-followup1a`: PASS, 70 named mutations killed by their own rules.
- `validate-all` at `fd2fe55`: 152/155 PASS (the 2 known baseline failures, plus AG-5 from the owner-approved TEMPORARY seo-agency allowlist entry for the exit proof, by design).
- `validate-no-secrets`: PASS. No provider spend: the diagnostic Codex run used the owner's ChatGPT sign-in
  in Codex's read-only sandbox, not the OpenAI key.

## Carried forward (LOW, none CRITICAL/HIGH/MEDIUM open)

- **Quote inside or around the host** (`\\l"o"calhost\c$`, `"\\localhost"\c$`) still passes; it resolves.
  It is deliberate hiding, which this text heuristic already says it does not catch.
- **Bare host** (`net view \\localhost`, `dir \\localhost`) is not a denial by design: it names no file.
- **Pre-existing, not caused by this phase (both rules pass them):** a UNC path after `::`, `;`, `,` or `<`
  (`FileSystem::\\host\…`, `-LiteralPath:\\host\…`), three or more leading separators or `/\host`, and a
  JS-escaped `'\\\\localhost\\c$'`. If fixed, keep `://` excluded (use a look-behind on `::`).
- **False positives that fail closed:** a string that starts with an escape, then 2+ word characters, then
  another escape (`"\\tname\\tvalue"`, `"\\nExpires:x\\n"` with no space), and a regex in a JS string such as
  `"\\.\\d+"`. A false positive refuses a review with a stated reason; it never credits one.
- **Wider:** the reviewer may RUN candidate code inside its read-only sandbox (run 1's reviewer ran the
  candidate validator through `vm`). The loop's own validators already run candidate code with more
  privilege, so this is no new exposure, but loopback is reachable from the sandbox.
