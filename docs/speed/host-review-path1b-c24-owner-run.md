# PATH1B — C24: the elevated real-pipe proof (OWNER RUN)

Written for: Murad. One bounded action; copy-paste, run, paste the output back.

## What this proves, and what it cannot touch

Criterion 24: the real isolated pipe proofs pass on a RUN-SCOPED TEST ENDPOINT in an elevated shell —
a real Windows named pipe, the real DACL, the real codecs and client order. The endpoint name is
`\\.\pipe\ProjectOS.Test.ServiceIdentityProof.<random>`; both facades REFUSE the production run
identifier, so `\\.\pipe\ProjectOS.Host` is unreachable by construction.

It does NOT and CANNOT: install or start the ProjectOSHost service, read any credential, contact any
provider, spend anything, change any ACL, write ProgramData, or touch the production endpoint. The
"Host" in the proof is a closure inside the test process.

Prerequisite: the ProjectOSHost service is INSTALLED (its per-service SID must resolve; the service
does not need to be running). Your machine has it installed since the §10G/§10H work.

## The action (one elevated PowerShell)

Open **PowerShell as Administrator**, then:

```powershell
cd C:\dev\ProjectOS-worktrees\host-review-path1b\projectos\host\windows-local-ipc
cargo test --offline --features windows-live-ipc,owner-approved-status-read,test-fixtures `
  --test live_host_review_exchange -- --ignored --nocapture --test-threads=1
```

## The expected safe result

- `running 2 tests` … `test result: ok. 2 passed` (the two `#[ignore]`d proofs), plus the always-on
  leg test if it is selected, printing `LEG: ANSWERED (allowlisted principal)`.
- If Windows refuses the connection for a non-allowlisted principal, the output prints
  `LEG: OS-REFUSED (...)` — that is a REPORTED refusal, not a failure to run; paste it as-is.
- Anything else (a panic, a `FAILED`): stop and paste the whole output; nothing needs cleanup —
  the endpoint is process-scoped and dies with the test.

## What to send back

The final `test result:` lines and any `LEG:` lines, verbatim. That closes C24.
