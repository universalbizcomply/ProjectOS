# PROJECTOSHOST-ACL-SERVICE-START-COMPATIBILITY-PREFLIGHT1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-ACL-SERVICE-START-COMPATIBILITY-PREFLIGHT1A |
| **Date** | 2026-08-05 |
| **Branch / HEAD** | `projectos-v3` @ `fc0f45d4b4256c49055f698cccf1899f143112fd` |
| **Gate** | read-only source and machine preflight; records-only report |
| **Decision requested** | **PREFLIGHT ACCEPTED — OWNER START/STOP GATE REQUIRED** |

The service was not started, stopped, restarted, paused or reconfigured. No ACL, registry, ProgramData, credential, provider, `.projectops`, installer or updater action occurred.

---

## 1. Headline

**Starting the service is NOT side-effect free, and this report does not claim it is.** Proven from source: the running service creates a local named-pipe endpoint, resolves the service SID to secure it, and — **only after an accepted client handshake** — reads its own executable and the installed identity record. Both are reads.

**No write path exists anywhere in the service binary.** A search across `projectos/host/service-host/src/` for `fs::write`, `File::create`, `OpenOptions`, `create_dir`, `remove_file`, `WriteFile`, `RegSetValue` and `SetFileSecurity` returned **NONE FOUND**.

**Elevation is required**, and this is now proven rather than assumed — see §4.

One material finding outside the start question is recorded in §8: the shipped binary **cannot be rebuilt from committed source alone**.

---

## 2. Accepted baseline (not re-verified as work, confirmed as context)

`PROJECTOS-HOST-BINARY-CUSTODY-ACL-HARDENING1A` is CLOSED at `fc0f45d`. The hardened state was re-read read-only for this preflight and shows no drift: all three objects owner `NT AUTHORITY\SYSTEM`, DACLs protected, zero ordinary-user ACEs, live SDDL string-identical to the recorded `after-sddl.txt`; executable SHA256 `512820C7…72BB9C56`, 320000 bytes, both timestamps unchanged; service `Stopped` / `DEMAND_START`. F1 is closed and was not reopened or repeated.

---

## 3. Source review and classification

| Statement | Class |
|---|---|
| Service name frozen as `ProjectOSHost` (`main.rs:37`) | SOURCE-BACKED FACT |
| SCM publishes StartPending / Running / StopPending / Stopped (`scm.rs`) | SOURCE-BACKED FACT |
| `scm.rs:173` calls `serve::serve_installed_host_status_until_stop` after `lifecycle.running()` | SOURCE-BACKED FACT |
| Serve loop creates a pipe endpoint per iteration and resolves pipe security per attempt (`serve.rs:45-52`) | SOURCE-BACKED FACT |
| `status::observe` runs only after an accepted handshake (`serve.rs:26-32`, callback passed into the façade) | SOURCE-BACKED FACT |
| `status.rs` is read-only — reads its own image and the identity record, "writes nothing" (`status.rs:10`) | SOURCE-BACKED FACT |
| No write API anywhere in `service-host` | SOURCE-BACKED FACT (exhaustive search, NONE FOUND) |
| Pipe is local-only (`PIPE_REJECT_REMOTE_CLIENTS`) | SOURCE-BACKED FACT |
| Only `SY` and `BA` hold `RP` (SERVICE_START) | SOURCE-BACKED FACT (live `sc sdshow`) |
| No failure actions configured | SOURCE-BACKED FACT (live `sc qfailure`: `RESET_PERIOD 0`, no actions) |
| `main.rs` doc claiming "no file… or ProgramData access" | **STALE** — see §7 |
| `service-host/Cargo.toml` does not enable `windows-live-ipc` | SOURCE-BACKED FACT — see §8 |
| Start will succeed under the hardened ACLs | **INFERENCE** — this is exactly what the live gate must test |
| F1 closure and its ratification | OWNER / GATEKEEPER DECISION |

---

## 4. The thirteen preflight questions

**1 — Exact start command.** `Start-Service -Name 'ProjectOSHost' -ErrorAction Stop` (equivalently `sc.exe start ProjectOSHost`). The service name is frozen in source and is not derived from the file name, command line or environment.

**2 — Expected states and deadlines.** `Stopped` → `StartPending` → `Running`, then `StopPending` → `Stopped`. The four states are exactly those `scm.rs` publishes. **Deadline: 6 seconds per transition**, adopting the installer's own committed bound of 30 polls × 200 ms rather than inventing one.

**3 — Does starting require elevation? YES — proven, not assumed.** The live service security descriptor is:

```
D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)
  (A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)
  (A;;CCLCSWLOCRRC;;;IU)
  (A;;CCLCSWLOCRRC;;;SU)
```

`SY` and `BA` carry `RP` (SERVICE_START) and `WP` (SERVICE_STOP). **`IU` (Interactive Users) and `SU` (Service logon users) carry neither** — they hold query, enumerate, interrogate and read-control only. A non-elevated interactive session therefore cannot start or stop this service, and the live proof must run from an elevated context.

**4 — Prove the running process uses the accepted binary.** Resolve the service's PID from `Get-CimInstance Win32_Service -Filter "Name='ProjectOSHost'"`, then read `Win32_Process.ExecutablePath` and `CommandLine` for that PID, and compare the path to the accepted `C:\Program Files\ProjectOS\host\ProjectOSHost.exe` and re-hash that file. Compare the image path, not just the service configuration, so a substituted image would be visible.

**5 — Prove hash and ACL unchanged.** Re-hash the executable and compare to `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56`; re-read all three SDDLs and compare **string-identically** to the recorded `after-sddl.txt` in the durable proof directory. Also re-read size and both timestamps.

**6 — Windows service and event-log evidence.** `System` log, provider **Service Control Manager**, **Event ID 7036** (service entered the running / stopped state), filtered to `ProjectOSHost`, bounded to the proof window. Failure evidence: **7000** (failed to start), **7009** (timeout), **7023/7024** (terminated with an error). Both channels are enabled (`System` 36 209 records, `Application` 21 422). The most recent SCM entries for this service are **7045** installation events from 2026-08-01; no start/stop entries fall inside the current 200-event window.

**7 — Process identity evidence.** `Win32_Service.StartName` must read `NT SERVICE\ProjectOSHost` (configuration), **and** the running process token must be read directly — a read-only `OpenProcessToken` + `TokenUser` probe resolving to SID `S-1-5-80-3378865708-3397408971-155286320-2096107322-2736411702`. Configuration alone proves what was requested, not what is running.

**8 — Service SID and virtual account still correct.** Re-run `sc.exe qc` (expect `SERVICE_START_NAME: NT SERVICE\ProjectOSHost`, `START_TYPE 3 DEMAND_START`, `TYPE 10 WIN32_OWN_PROCESS`, no dependencies, no load-order group) and `sc.exe qsidtype` (expect `UNRESTRICTED`), before and after.

**9 — Does starting cause a machine, network or provider side effect? PROVEN FROM SOURCE, and the answer is yes for one narrow case.**

| Effect | Occurs on start? | Evidence |
|---|---|---|
| Named-pipe endpoint created (kernel object) | **YES**, per loop iteration | `serve.rs:45-48` |
| Service SID resolved for the pipe DACL | **YES**, per attempt | `serve.rs:46`, `resolve_installed_host_pipe_security` |
| SCM state transitions published | **YES** | `scm.rs` |
| System event-log 7036 written by Windows | **YES** — external to our code, unavoidable | OS behaviour |
| Own executable read and hashed | **only after an accepted handshake** | `serve.rs:26-32`, `status.rs:51-55` |
| ProgramData identity record read | **only after an accepted handshake** | `status.rs:77-107` |
| **Any file, registry or ProgramData WRITE** | **NO** | exhaustive search: **NONE FOUND** |
| **Network** | **NO** | no network feature in the crate's `windows` dependencies; pipe sets `PIPE_REJECT_REMOTE_CLIENTS` |
| **Provider / credential activity** | **NO** | no such dependency in the service graph |
| **Child process** | **NO** | no process-creation API in the crate |

The pipe is genuinely local and unreachable from the network, and with no client connecting there is no read of ProgramData at all.

**Residual uncertainty, stated rather than smoothed over:** the endpoint is created and torn down on a roughly 2-second cadence for as long as the service runs. That is a repeated kernel-object create/close, not a persistent change, but it is a real, observable machine effect and the proof window should be kept short.

**10 — Stop and recovery plan.** One `Stop-Service -Name 'ProjectOSHost' -ErrorAction Stop`, bounded to 6 s, then confirm `Stopped`, confirm no `ProjectOSHost` process, and confirm no ProjectOS named pipe remains. No configuration change at any point. If the service will not stop within the deadline: capture evidence, do **not** kill the process, do **not** reconfigure, and report.

**11 — Automatic stop conditions.** Halt immediately and stop the service if any of: the transition deadline expires; the state is anything other than the expected one; the running image path is not the accepted binary; the executable hash changes; any of the three SDDLs stops matching the recorded values; the ProgramData ACL changes; an unexpected child process appears; any write is observed under `C:\Program Files\ProjectOS` or `C:\ProgramData\ProjectOS`.

**12 — Rollback conditions.** The proof makes no persistent change, so **no rollback should ever be required**. If drift is nevertheless detected, the correct action is to stop and report — **not** to run `rollback.ps1`, which would reopen F1 and needs its own authorisation. The ACL rollback material remains intact in the durable proof directory and is unrelated to this proof.

**13 — Smallest owner authorisation.** Drafted verbatim in §6.

---

## 5. Live-proof design

**PRE-START** — repository and remote reconciled at the accepted head; service `Stopped`; binary path is the accepted path; SHA256 matches; all three SDDLs match the recorded values; ProgramData ACL unchanged; durable rollback evidence present and hash-verified; no ProjectOS credential entries; no `.projectops`; no ProjectOSHost process; no ProjectOS pipe; capture the pre-start event-log high-water mark.

**START** — exactly one `Start-Service`, from an elevated context (required per §4.3), bounded to 6 s. No configuration change of any kind.

**RUNNING PROOF** — state `Running`; PID resolved from the service; process image path equals the accepted binary; process token SID equals the service SID; executable hash, size and timestamps unchanged; all three SDDLs still string-identical; ProgramData ACL unchanged; no child process of the service PID; no network endpoint owned by the PID; no credential or provider activity; exactly one expected ProjectOS pipe present; event evidence limited to the expected 7036.

**STOP** — exactly one `Stop-Service`, bounded to 6 s; state returns to `Stopped`; no process remains; no pipe remains; no configuration change; re-verify hash and all three SDDLs a final time.

**FAILURE HANDLING** — stop immediately on stall or failure; capture redacted service and event evidence; do **not** reinstall, broaden ACLs, change identity, start type or failure actions, or retry through a different executable; return the machine to `Stopped` where safely possible.

---

## 6. Draft owner authorisation for the later live phase (NOT executed)

> **PROJECTOSHOST SERVICE-START COMPATIBILITY LIVE PROOF — APPROVED**
>
> I authorise, from an elevated context, exactly:
> - **one** start of the `ProjectOSHost` service;
> - a **bounded read-only** running-state proof not exceeding 5 minutes;
> - **one** stop of the `ProjectOSHost` service;
> - read-only service, process, event-log, file-hash and ACL checks.
>
> I do **not** authorise: service installation or reconfiguration; any ACL or ownership change; ProgramData mutation beyond unavoidable source-proven service startup behaviour; credential creation, access or migration; provider calls; IPC or host-custody implementation; `.projectops` installation; production operations; database mutation; deployment; real sends or payments; rollback execution; killing the service process; or a retry through any other executable.
>
> If the service fails to reach Running within 6 seconds, or any hash, ACL, image-path or identity check fails, stop immediately, return the service to Stopped where safely possible, and report without further remediation.

---

## 7. Correction to a stale source comment

`main.rs:8-13` states the service performs "no file, registry, network, IPC or ProgramData access". **That comment is stale.** It was accurate for `CD-B4-PROJECTOSHOST-SERVICE-RUNTIME1A`, when the service was an inert loop. The later functional pilot (`c213078`) added `serve.rs` and `status.rs`, and `scm.rs:173` now calls the serve loop, which does perform IPC and — after an accepted handshake — reads ProgramData.

The same stale claim is repeated in the crate `description` in `service-host/Cargo.toml`.

This is a **documentation defect, not a behaviour defect**: the actual behaviour is read-only and bounded, exactly as `serve.rs` and `status.rs` describe. It is recorded here rather than corrected, because source modification is outside this gate's boundary. It matters because anyone reasoning about start side effects from `main.rs` alone would reach the wrong conclusion — which is precisely the inference this gate forbade.

---

## 8. Finding: the shipped binary cannot be rebuilt from committed source alone

`serve.rs` imports `resolve_installed_host_pipe_security` unconditionally, and `main.rs:31` declares `pub mod serve;` under `#[cfg(windows)]`. That symbol is gated `#[cfg(all(windows, feature = "windows-live-ipc"))]`.

But `service-host/Cargo.toml` requests `projectos-host-windows-local-ipc` with features `["owner-approved-status-read"]` **only**, and `owner-approved-status-read = []` implies nothing. There is **no `.cargo/config.toml`, no `build.rs`, and no committed build or release script** that supplies `windows-live-ipc` to this crate.

Consequently a `cargo build` of `service-host` on Windows using committed configuration alone would **fail to compile**. The installed `ProjectOSHost.exe` must have been built with an uncommitted `--features` flag.

**This does not block the start proof** — the installed binary already exists, is hash-pinned, and has previously served status successfully. It is a **reproducibility and provenance gap**, and it is the same class of gap as the already-recorded absence of a committed call site for `install_once`. Both mean the live artefact's provenance is not fully captured in the repository.

Recommended follow-up phase: **`PROJECTOSHOST-BUILD-PROVENANCE-CAPTURE1A`** — commit the exact feature set and build invocation, source-only, no rebuild.

---

## 9. Programme position — unchanged

`acceptedPhaseCount` **4 / 19**, **21.1**, plan v1.0, Phase 13 CLOSED, `EXECUTION_READY` **false**, `installationAuthority` **NotAuthorised**, `86ae19c` and `a43898d` OPEN. Custody findings **F2**, **F3**, **F4**, **F5** remain OPEN. Gates **C4**, **C6**, **C7** remain open and **C7 remains prohibited**. No new accepted implementation baseline.

---

## 10. Decision requested

**PREFLIGHT ACCEPTED — OWNER START/STOP GATE REQUIRED**

The start sequence, deadlines, elevation requirement, identity and integrity proofs, evidence sources, stop plan, automatic-stop conditions and rollback position are all specified and source-backed. The side-effect question was answered from source rather than inferred: one narrow, local, repeated kernel-object effect and two conditional reads, with no write path anywhere in the binary.

I am not recommending **DO NOT START**. The two findings above are a stale comment and a build-provenance gap; neither indicates a compatibility or side-effect risk from starting the service under the hardened descriptors. Whether the service actually starts under them is exactly the question the live gate exists to answer, and it cannot be settled without starting it.
