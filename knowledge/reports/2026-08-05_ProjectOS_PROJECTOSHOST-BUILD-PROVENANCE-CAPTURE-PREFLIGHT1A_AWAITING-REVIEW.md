# PROJECTOSHOST-BUILD-PROVENANCE-CAPTURE-PREFLIGHT1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-BUILD-PROVENANCE-CAPTURE-PREFLIGHT1A |
| **Date** | 2026-08-05 |
| **Branch / HEAD** | `projectos-v3` @ `ba100b9de34fc1aeff1cfdc727ac9bada50f58fa` |
| **Gate** | read-only source-led preflight; records-only commit |
| **Decision requested** | **PREFLIGHT ACCEPTED — BUILD-PROVENANCE IMPLEMENTATION GATE REQUIRED** |

No installed binary, service, ACL, ProgramData or registry change. No installation, no credential, no provider. All build probes ran into isolated target directories outside the repository.

---

## 1. Correction — my previous finding was wrong

**The preflight finding that `windows-live-ipc` is not supplied by committed configuration is FALSE, and I am withdrawing it.**

`service-host/Cargo.toml` declares `projectos-host-windows-local-ipc` **twice**. I read only the first:

```toml
[dependencies]
projectos-host-windows-local-ipc = { path = "../windows-local-ipc", features = [
    "owner-approved-status-read",
] }

[target.'cfg(windows)'.dependencies]          # <-- I never reached this block
projectos-host-windows-local-ipc = { path = "../windows-local-ipc", features = [
    "windows-live-ipc",
    "owner-approved-status-read",
] }
```

**Root cause of my error:** I inspected the manifest with `sed -n '1,40p'`, which truncated before the target-specific block, and I did not corroborate the reading with the resolver. A 40-line window on a file I had not measured was the whole mistake.

The resolver is unambiguous:

```
projectos-host-windows-local-ipc
├── feature "default"                      <- projectos-host-service-host
├── feature "owner-approved-status-read"   <- projectos-host-service-host
└── feature "windows-live-ipc"             <- projectos-host-service-host
```

**Where the false claim was published:** the service-start compatibility preflight report §8 and its Reports Index row (commit `4317bf8`), and a carry-forward line in the live-proof report and Index row (commit `ba100b9`). Both are committed. Correcting those records is **outside this phase's two-path boundary** and is included in the follow-up plan (§16, step 6).

---

## 2. Repository and remote baseline

local `= origin =` `ba100b9de34fc1aeff1cfdc727ac9bada50f58fa`; ahead/behind **0/0**; 0 dirty. Service `Stopped`/`Manual`; installed executable SHA-256 unchanged. Toolchain `cargo 1.96.1` / `rustc 1.96.1 (31fca3adb 2026-06-26)`. `Cargo.lock` present in `service-host` (13,015 bytes, dated 2026-08-01). There is **no repository-root `Cargo.toml`** and **no workspace** — every host crate is standalone.

---

## 3. Installed binary identity

| | |
|---|---|
| SHA-256 | `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` |
| Length | 320,000 |
| LastWriteUtc | `2026-08-01T19:56:30.6025680Z` |
| PE machine / subsystem | `0x8664` x64 / `3` CONSOLE |
| PE TimeDateStamp | `0x6A6E4F6E` = `2026-08-01T19:56:30Z` |
| Sections | 5 |
| Version resource | **none** |
| Embedded PDB path | **none** |
| Authenticode | **NotSigned** |

**Feature markers present:** `ProjectOS.Test.ServiceIdentityProof`, `POSHSTAT`, and the console-mode refusal string. Those pipe strings exist only when `windows-live-ipc` is compiled, so the installed binary demonstrably carries the live-IPC graph.

---

## 4. Committed build graph and feature activation

**Question 3 — was `windows-live-ipc` enabled by an uncommitted command line, environment variable or local Cargo configuration? NO.** It is enabled by a committed target-specific dependency. There is no `.cargo/config.toml`, no `build.rs` for this crate, and no `[features]` section in its manifest. On Windows the feature is **non-optional by construction** — a plain `cargo build` cannot omit it.

**Question 4 — can the exact build command be reconstructed? YES:**

```
cd projectos/host/service-host
cargo build --release
```

No `--features`, no `RUSTFLAGS`, no environment. Verified by execution (§5).

---

## 5. Isolated build probes

All probes used `CARGO_TARGET_DIR` outside the repository. Nothing was copied into Program Files, installed or started.

| # | Command | Result |
|---|---|---|
| 1 | `cargo build --release` (committed config only) | **SUCCESS, exit 0, 33.94 s** |
| 2 | `RUSTFLAGS=-Cdebuginfo=0 cargo build --release` | success — **no effect**, release already implies it |
| 3 | `RUSTFLAGS=-Clink-arg=/Brepro cargo build --release` | success — deterministic link |
| 4 | probe 3 repeated into a fresh target directory | success |

**Probe 1 is the headline: the binary builds from committed source and configuration alone.** The claim that it could not is refuted by execution.

*Disclosed:* the first `/Brepro` attempt failed under Git Bash because MSYS rewrote `/Brepro` into `C:/Program Files/Git/Brepro`. That was a shell path-conversion artefact, not a toolchain limitation; re-running through PowerShell succeeded.

---

## 6. Byte-reproducibility result

**Installed vs. a fresh build from current HEAD:**

| | |
|---|---|
| Lengths | 320,000 vs 320,000 — **equal** |
| Machine / subsystem / section count | **identical** |
| **Differing bytes** | **28 of 320,000 — 0.0088 %** |

**Every differing byte is attributed, not assumed.** Parsing the PE debug directory (RVA `0x45620`, file offset `0x43E20`, 3 entries of 28 bytes) accounts for all of them:

| Range | Size | Identity |
|---|---|---|
| `0x000000F0`–`0xF2` | 3 | PE COFF **TimeDateStamp** (`peOff+8`) |
| `0x00043E24`–`0xE26` | 3 | debug entry 0 **CODEVIEW** TimeDateStamp |
| `0x00043E40`–`0xE42` | 3 | debug entry 1 **VC_FEATURE** TimeDateStamp |
| `0x00043E5C`–`0xE5E` | 3 | debug entry 2 **POGO** TimeDateStamp |
| `0x00043F78`–`0xF87` | 16 | **CodeView RSDS PDB GUID** (record at `0x43F74`, `+4`) |

**Four linker timestamps and one debug GUID. Zero differences in code or data** — all 319,972 remaining bytes are identical.

**Question 5 — byte-for-byte reproduction of the *installed* artefact: NO**, because those five fields cannot be recovered after the fact.

**Question 6 — deterministic identity provable instead: YES, and better than expected.**

| Builds | Result |
|---|---|
| two plain `--release` builds | `DC68D976…` vs `07372E7E…` — **differ** |
| two `/Brepro` builds, independent target dirs | `05D2E050…` vs `05D2E050…` — **byte-identical, 0 of 320,000 differ** |

`/Brepro` replaces the timestamp with a content hash (`0x51FC51A2`, not a plausible clock) and adds a REPRO debug entry (directory 84 → 112 bytes). **Fully deterministic builds are available today with one linker flag and no source change.**

---

## 7. Which commit corresponds to the installed binary?

Build stamp `2026-08-01T19:56:30Z`; installed `2026-08-01T20:17:16Z`. Commits touching `service-host` or `windows-local-ipc` around then: `c213078` (16:19 +01:00), `193bee9` (17:12 +01:00), `bd35e44` (19:43 +01:00 = 18:43 UTC). `0eee58e` lands at 20:10 UTC, between build and install. So by timestamp the binary was built at or after **`bd35e44`** and before `0eee58e`.

**A stronger answer than timestamp inference:** because a build from **current HEAD** reproduces the installed binary's code and data exactly, the installed executable's code **is** what today's committed source produces. Its provenance is pinned by content, not by a guessed commit. That is a SOURCE-BACKED FACT; the commit window above is INFERENCE.

---

## 8. Installer and CI impact

The build contract already has a consumer. `host-identity` owns one release-manifest algorithm — `release_manifest_canonical_bytes` and `release_manifest_digest_for_artefact_digest` — the installer delegates to it, the record stores `release_manifest_digest`, and the running service recomputes it for its own image. `val-cd-b4-release-currentness1a` pins that there is exactly one algorithm, that the installer keeps no copy, and that `Ready` requires a proven manifest match.

**So a build contract does not need inventing — it needs committing and enforcing.**

**CI: absent.** There is **no `.github/workflows`**, no committed build script, and no `package.json` script that builds the host. Nothing today would reject a service binary built from a different feature set.

---

## 9. Options considered

| | Option | Assessment |
|---|---|---|
| **A** | Commit the production feature into the target's normal build configuration | **Already done.** The target-specific dependency achieves exactly this. Nothing to change. |
| **B** | Commit one explicit build script or Cargo alias activating the feature set | Feature activation is not the problem. A committed *command* is still worth having — but for determinism and auditability, not activation. |
| **C** | Separate production-service package with an explicit non-optional feature graph | Rejected. Real cost, new package, validator churn, and it solves a problem that does not exist: the graph is already non-optional on Windows. |
| **D** | **Commit determinism + a build contract, no feature change** | **RECOMMENDED.** |

---

## 10. Recommended architecture — Option D

Three small, committed additions. No source change to the service, no feature-graph change, no new package.

1. **Determinism.** Commit `-Clink-arg=/Brepro` for this target — a `.cargo/config.toml` scoped to `service-host`, or explicit `RUSTFLAGS` in the committed build command. Proven in §6 to make independent builds byte-identical.
2. **A committed build command** recording directory, profile, flags and toolchain, so the artefact is auditable rather than reconstructed.
3. **A validator** asserting the binary the record describes matches a freshly built one, and that the live-IPC markers are present — the anti-substitution check CI lacks today.

**Risk of accidentally enabling live IPC in fixture or default builds: unchanged.** Option D touches no feature declaration. `windows-live-ipc` remains scoped to `cfg(windows)` for this binary, and `test-fixtures` remains separate and non-default.

**Estimated changed paths: 2–4** — a `.cargo/config.toml`, a build script or npm script, one validator, and its registration.

---

## 11. Frozen follow-up implementation plan

**Phase ID:** `PROJECTOSHOST-BUILD-PROVENANCE-CAPTURE1A`
**Commit subject:** `feat(host): commit ProjectOSHost deterministic build contract`

| Item | Detail |
|---|---|
| Files | `projectos/host/service-host/.cargo/config.toml` (`/Brepro`); one committed build command; `projectos/validators/val-projectoshost-build-provenance1a.cjs`; its registration in `validate-all.cjs` |
| Build contract | directory `projectos/host/service-host`; `cargo build --release`; no `--features`; `RUSTFLAGS=-Clink-arg=/Brepro`; toolchain pinned and recorded |
| Enforcement | validator asserts the `/Brepro` flag is committed, the target-specific `windows-live-ipc` dependency is present, and `test-fixtures` is **not** in the production graph |
| Installer consumption | none changed — the existing release-manifest digest already binds record to image |
| Binary identity evidence | two independent builds byte-identical; markers present |
| Positive tests | committed-config build succeeds; two builds byte-identical; markers present |
| Negative tests | removing `/Brepro` makes two builds differ; removing the target-specific dependency fails compilation; a `test-fixtures` build is refused |
| Mutations | drop `/Brepro`; drop the windows dependency; add `test-fixtures`; alter the recorded command — each must fail the validator |
| Rollback | records + config only; revert the commit. No installed artefact touched |
| Prohibited | no rebuild of the installed binary, no reinstall, no service action, no ACL change, no signing, no credential or provider activity |

**Fixture and production graphs stay explicitly separated. No raw secret handling. No installation. No live provider activity. No automatic production activation.**

---

## 12. Question 10 — is this blocking?

**No.** Build provenance is in far better shape than the earlier finding suggested: the binary builds from committed configuration, its code and data are reproducible from HEAD, and determinism is one flag away. **This does not block F2–F5 or credential-custody work.**

It should still be closed before custody ships, for one reason: the moment the host holds real credentials, "is the running binary the one we reviewed?" becomes a security question rather than a hygiene one. The release-manifest digest already answers it at install time; §10 makes it answerable at **build** time too.

**The binary remains unsigned** (`NotSigned`), and the publisher policy is empty and fail-closed by design. Determinism is not a substitute for signing; it is the prerequisite that makes signing meaningful.

---

## 13. Programme position

`acceptedPhaseCount` **4 / 19**, **21.1**, plan v1.0, Phase 13 CLOSED, `EXECUTION_READY` **false**, `installationAuthority` **NotAuthorised**, `86ae19c` and `a43898d` OPEN. No new accepted baseline.

**F2** (no IPC authentication or confidentiality), **F3** (no non-elevated user→host channel), **F4** (DPAPI-under-virtual-account restart survival NOT FOUND) and **F5** (non-durable single-use grant ledger) remain **OPEN**. **C4**, **C6**, **C7** remain open; **C7 remains prohibited**.

---

## 14. Decision requested

**PREFLIGHT ACCEPTED — BUILD-PROVENANCE IMPLEMENTATION GATE REQUIRED**

The question this phase was created to answer has a different answer than expected: the installed binary **is** buildable from committed source and configuration, and the earlier claim to the contrary was my reading error, now withdrawn and root-caused. What remains is genuinely smaller — commit one linker flag, one build command and one validator, and builds become byte-identical across machines.

Two things need your attention: the follow-up phase in §11, and the fact that **two committed reports and two Index rows carry my false finding** and need correcting under their own gate.
