# PROJECTOS-KERNEL-CODEX-LIVE1A — Codex reviewer fixes from the live sandbox probe

**Phase:** PROJECTOS-KERNEL-CODEX-LIVE1A, plan v1.21 (activation `37af3b7`). Owner, 2026-10-29, verbatim:
"Yes, run it (Recommended)" (live exit proof, starting with a Codex probe); "Accept tripwires
(Recommended)" (the Codex-reads-login residual); "Yes, temporarily (Recommended)" (agency spend for the
proof only).
**Branch:** `projectos-autonomy-bootstrap1a` (worktree `host-review-path1b`). Not pushed at the time of
writing.
**Exclusions honoured:** the adapter stays reviewer-only in a read-only sandbox, with no credential argument;
the Windows sandbox mode is fixed by the adapter, never configurable. No owner gate, closure predicate or
`ownerOnlyActions` changed.

## The live probe (precondition M3 of FOLLOWUP1A)

Codex CLI 0.165.0 on the owner's host, ChatGPT sign-in (no API key), each run against a throwaway git
repository in the session scratchpad. No file was written by any run.

| Run | Result |
|---|---|
| `--sandbox read-only --ignore-user-config`, no Windows sandbox mode | Codex ran **no command**: read, inside write and outside write all "rejected: blocked by policy". A reviewer could never review. |
| Same with `-c windows.sandbox="unelevated"` and with `"elevated"` | Reads in the checkout work; writes inside AND outside the checkout refused ("Access to the path … is denied", `UnauthorizedAccessException`); no file appeared. **The read-only sandbox is enforced.** |
| Command form | Every command reported as `"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command '…'` — read whole, an absolute path outside the checkout, so the FOLLOWUP1A tripwire would have refused every review. |
| Profile read (dummy file the lead placed in `%USERPROFILE%\.codex`, never the login) | **Readable** in both modes. The HIGH 1 residual is real; the owner accepted it as tripwire-only. |
| Network, elevated | Loopback **reachable** (`Invoke-WebRequest`, `curl.exe` hit a 127.0.0.1 listener); internet **blocked** (`https://example.com` → 000 in the sandbox, 200 from the host). |
| Event fields | `command_execution` items carry `id, type, command, aggregated_output, exit_code, status` — no working directory. |
| stdin | Codex prints "Reading additional input from stdin…"; ProjectOS's `spawnSync` gives the child an immediate EOF (checked), so no hang. |
| **Smoke of the real adapter path** after the fix | `codexReviewArgv` + `readCodexEvents` + `codexReviewEnvelope` against the live binary: exit 0, `num_turns` 3, `permission_denials` [], reply as asked. |

## Delivered

| # | Item | Tests / pins |
|---|---|---|
| 1 | The adapter always passes `-c windows.sandbox="elevated"`, the ONE override the final gate admits (exact adjacent pair, once). Any other `-c`/`--config`, attached short forms (`-csandbox_mode=…`, `-sdanger-full-access`, `-p…`) and joined long forms are refused by both the configured-args allowlist and `sandboxProblem`. | argv `toEqual`; admission/refusal cases; CX-12 (7 mutations) |
| 2 | `innerCommand()` judges the command inside a KNOWN shell wrapper (system-path `powershell.exe` with optional `-NoProfile`, `pwsh.exe` 7, `cmd.exe /c` case-insensitive, `bash`/`sh -c`/`-lc`), one layer; unknown wrappers, other flags, `-EncodedCommand`/`-File` at the wrapper, and nested wrappers stay whole and fail closed. | probe forms, fail-closed variants, credited PowerShell-wrapped read; CX-13 (7 mutations) |
| 3 | Network fetch and decode-and-run commands (`Invoke-WebRequest`, `Invoke-RestMethod`, `iwr`/`irm`, `curl`, `wget`, `Net.WebClient`, `System.Net.`, `Start-BitsTransfer`, `certutil`, `-EncodedCommand`, `FromBase64String`, `Invoke-Expression`/`iex`) are denials; "blocked by policy" is a sandbox refusal. | 6 cases; CX-14 (3 mutations) |

## Reviews

- **Claude self-review** (lead): the probe design (dummy file, loopback listener, no real secret), the fix,
  tests, pins.
- **ECC SECURITY review** (independent) at `b350f2d`: **APPROVE WITH CHANGES**, no CRITICAL/HIGH. Wrapper
  stripping cannot hide a path in the inner script; the one admitted `-c` pair is safe through the
  supported path. MEDIUM 1 (a reviewer-chosen working directory reads outside the checkout with no path in
  the command; the event carries no cwd) — **cannot be detected**; it is inside the owner-accepted
  "determined attacker" residual and is named here. MEDIUM 2 (egress) — probed: internet blocked,
  loopback open; fetch commands made denials. MEDIUM 3 (an unprovisioned host) — carried. LOW 4–8 fixed in
  `65c42d6`. No second round: every post-review change only tightens, and each has a named mutation.

## Verification

- Agent: `tsc` and `typecheck:tests` clean; changed suites 198/198; full suite 2877/2877.
- `val-projectos-kernel-followup1a`: PASS, 66 named mutations killed by their own rules.
- `validate-all` at `65c42d6`: 153/155 PASS (the 2 known baseline failures: validate-desktop-e2e, val-cd-b4-sealed-expected-window-facts1a).
- `validate-no-secrets`: PASS.
- Provider use: Codex CLI runs on the owner's ChatGPT plan only (7 short probe/smoke runs); no OpenAI API
  spend.

## Carried forward

- **Residual risk, owner-accepted as tripwire-only:** the reviewer can read the owner's profile (including
  `~/.codex`), via a path the tripwire misses or a working directory it cannot see; loopback is reachable.
  Proportion: the candidate's own code already runs under the owner's identity in the validator checks, so
  a hostile candidate can read those files directly; the reviewer route adds little exposure beyond that.
  Revisit (separate low-value reviewer login, or a separate Windows user) before Codex reviews untrusted
  code.
- **MEDIUM 3:** on a host where Codex's elevated Windows sandbox is not provisioned, behaviour is not
  evidenced (it may fail closed or attempt provisioning). Provisioning is a one-time owner action; this
  host is provisioned.
- Obfuscated forms still pass the tripwires (caret-escaped `C^:`, a backslash-rooted `\Users`, scripts
  built at run time).
