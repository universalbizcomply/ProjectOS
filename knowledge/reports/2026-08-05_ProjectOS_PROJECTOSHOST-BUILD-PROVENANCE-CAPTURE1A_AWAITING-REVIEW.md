# PROJECTOSHOST-BUILD-PROVENANCE-CAPTURE1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-BUILD-PROVENANCE-CAPTURE1A |
| **Parent** | `PROJECTOSHOST-BUILD-PROVENANCE-CAPTURE-PREFLIGHT1A` (accepted, `aaf9465`) |
| **Baseline** | `projectos-v3` @ `f10e5349720992fdd4f8bd46999b809fc6d33979` |
| **Result** | two independent clean builds **byte-identical, 0 of 320,000 bytes differ** |
| **Decision requested** | **ACCEPTED — DETERMINISTIC BUILD PROVENANCE CAPTURED** |

No installed-binary change. No service start, stop or reconfiguration. No ACL, ProgramData or registry change. No feature, dependency or package change. All builds ran into isolated target roots outside the repository.

---

## 1. Two frozen-contract conflicts, resolved in the open

I did not stop on either, because both resolve cleanly and stopping would have delivered nothing. Both are stated for ratification.

**Conflict 1 — path arithmetic.** Frozen §11 lists **four** implementation files. This gate's §7 caps the "total repository boundary" at 2–4 paths, while **A12 mandates** producing report and Index evidence. Four implementation paths plus two records paths is six; A12 and a records-inclusive §7 cannot both hold.

*Resolution:* §7's ceiling is read as the **implementation** boundary — which is exactly how §2 fact 10 words it ("The accepted implementation boundary is 2–4 paths") — with report and Index as the separate boundary A12 requires. I then applied §7's "use the smallest subset" instruction and collapsed §11 items 1 and 2 into one file: a cargo `[alias]` **is** a committed build command. **Implementation is 3 paths, not 4.**

**Conflict 2 — validator count.** §11 and A9/A10 mandate a new validator registered in `validate-all.cjs`. The suite stood at **115** modules; registering the mandated validator necessarily makes it **116**. This gate's §12 asks for "115/115 PASS".

*Resolution:* the substantive requirement — **0 failures, ALL PASS** — is met at **116/116**. The 115 figure is arithmetically unreachable while A9/A10 stand. Flagged rather than quietly reported.

---

## 2. Frozen §11 contract, as extracted

| Item | §11 detail |
|---|---|
| Files | `.cargo/config.toml` (`/Brepro`); one committed build command; `val-projectoshost-build-provenance1a.cjs`; its registration |
| Build contract | dir `projectos/host/service-host`; `cargo build --release`; no `--features`; `RUSTFLAGS=-Clink-arg=/Brepro`; toolchain recorded |
| Enforcement | validator asserts `/Brepro` committed, target-specific `windows-live-ipc` present, `test-fixtures` **not** in the production graph |
| Installer consumption | none changed |
| Positive tests | committed-config build succeeds; two builds byte-identical; markers present |
| Negative tests | dropping `/Brepro` makes builds differ; dropping the dependency fails compilation; a `test-fixtures` build is refused |
| Mutations | drop `/Brepro`; drop the windows dependency; add `test-fixtures`; alter the recorded command |
| Commit subject | `feat(host): commit ProjectOSHost deterministic build contract` |

Architecture was not redesigned and the corrected `windows-live-ipc` finding was not revisited.

---

## 3. Implementation boundary — 3 paths

| Path | Change |
|---|---|
| `projectos/host/service-host/.cargo/config.toml` | **new** — `/Brepro` scoped to `x86_64-pc-windows-msvc`, plus the `production` build alias |
| `projectos/validators/val-projectoshost-build-provenance1a.cjs` | **new** — 7 assertions, B1–B7 |
| `projectos/validators/validate-all.cjs` | **+1 line** — registration only |

**No** `Cargo.toml`, `Cargo.lock`, package, dependency or feature change. **No** new crate. **No** installer change.

---

## 4. The committed deterministic build path

```toml
[target.x86_64-pc-windows-msvc]
rustflags = ["-Clink-arg=/Brepro"]

[alias]
production = "build --release"
```

Command: **`cargo production`**, run from `projectos/host/service-host`, no `--features`. Toolchain `cargo 1.96.1` / `rustc 1.96.1 (31fca3adb 2026-06-26)`, target `x86_64-pc-windows-msvc`, release profile.

**Target-scoped deliberately** — a bare `[build] rustflags` would apply `/Brepro` to every target, including non-MSVC ones where it is not a valid linker argument.

### Known bypass, stated not hidden

**Cargo lets the `RUSTFLAGS` environment variable *replace* these flags rather than merge with them.** A shell that already exports `RUSTFLAGS` will build **without** `/Brepro` and produce a non-reproducible binary, silently. No Cargo configuration can prevent this. It is recorded in the config file itself and answered directly in §9.

---

## 5. Feature-graph non-regression

`cargo metadata` exit 0. `cargo tree -e features` after implementation is **identical** to the pre-implementation resolution:

```
projectos-host-windows-local-ipc
├── feature "default"                    <- projectos-host-service-host
├── feature "owner-approved-status-read" <- projectos-host-service-host
└── feature "windows-live-ipc"           <- projectos-host-service-host
```

No feature added, removed or re-sourced. `test-fixtures` absent, as before.

---

## 6. Deterministic build proof

Both builds: same HEAD `f10e534`, same command, same target triple, same release profile, same feature graph, no uncommitted Cargo configuration, no injected feature flag, `RUSTFLAGS` unset, isolated clean target roots outside the repository.

| | BUILD 1 | BUILD 2 |
|---|---|---|
| Target root | `scratchpad/det-a` | `scratchpad/det-b` |
| Command | `cargo production` | `cargo production` |
| Exit | 0 | 0 |
| SHA-256 | `05D2E050525A59ED33F6DCFEA5B41304855927F92EFE6DAD6B502CA3D59A3317` | *same* |
| Size | 320,000 | 320,000 |
| PE arch | `0x8664` x64, 5 sections | *same* |
| TimeDateStamp | `0x51FC51A2` — a content hash, not a clock | *same* |
| Debug dir | 112 bytes (REPRO entry present) | *same* |
| Markers | `ProjectOS.Test.ServiceIdentityProof`, `POSHSTAT` | *same* |

> ### FULL-FILE COMPARISON: **0 differing bytes across all 320,000**
> Not a section-selective check — every byte compared.

**Disclosed:** BUILD 2 failed once on its first attempt (exit 101, `projectos-host-windows-activation-plan` did not compile) while several cargo and validator processes were running concurrently. The identical command from the identical clean root then succeeded, and the failure did not recur. It was transient resource contention, not a property of the build contract — but it happened, so it is recorded.

**Confirming rerun after all mutations were restored** (BUILD 3, `det-c`): SHA-256 `05D2E050…`, **0 differing bytes** against BUILD 1.

**No claim is made that this output equals the currently installed binary byte-for-byte.** §11 does not require it and it is not true: the installed binary predates `/Brepro` and carries real timestamps and a PDB GUID. The installed artefact was not touched.

---

## 7. Negative tests and mutations

Four frozen mutations, no invented categories.

| # | Mutation | Validator result | Restored |
|---|---|---|---|
| 1 | drop `/Brepro` | **FAIL** — B2 flag not in effect; B3 not inside the MSVC table | byte-identical ✅ |
| 2 | drop the `cfg(windows)` dependency | **FAIL** — B6 block no longer enables `windows-live-ipc`, exit 1 | byte-identical ✅ |
| 3 | add `test-fixtures` | **FAIL** — B7 fixture graph must stay out of the production binary | byte-identical ✅ |
| 4 | alter the recorded command (`--features`) | **FAIL** — B5 command passes `--features` | byte-identical ✅ |

Each failed for its **named expected assertion**, and the validator returned to PASS (exit 0) after every restore.

**Frozen negative test — dropping the dependency must fail compilation.** First attempt was **my mutation being too crude**: it cut mid-table and produced `error: invalid key-value pair, expected key`, a TOML syntax error rather than the specified compile failure. That is not the test, so I redid it with a clean structural removal — `cargo metadata` then parsed successfully, and the build failed for the right reason:

```
error[E0432]: unresolved imports
  `projectos_host_windows_local_ipc::resolve_installed_host_pipe_security`,
  `projectos_host_windows_local_ipc::ServeStatusOutcome`,
  `projectos_host_windows_local_ipc::WindowsInstalledHostStatusServer`
```

Exactly the three symbols `serve.rs` needs.

**Frozen negative test — dropping `/Brepro` makes two builds differ.** Established in the parent preflight: two plain builds produced `DC68D976…` and `07372E7E…`. Those measurements are unchanged and were not re-run here.

**Lockfile disclosure.** The mutation-2 compile modified `projectos/host/service-host/Cargo.lock` (7 deletions, the removed dependency's entries). It was restored with `git checkout --` and is byte-identical to HEAD. **No lockfile change appears in this commit.**

---

## 8. Validator contract — B1 to B7

B1 config exists · B2 `/Brepro` in effect · B3 target-scoped to MSVC, not `[build]`-wide · B4 committed `production` alias pinning the release profile · B5 command passes **no** `--features` · B6 the `cfg(windows)` block still supplies `windows-live-ipc` · B7 `test-fixtures` absent.

TOML comments are stripped before assertion, so a commented-out flag can never satisfy B2. The validator runs no cargo, hashes no binary and never touches the installed service — byte-identity evidence lives in this report, not in a validator that would need to build to produce it.

---

## 9. Adversarial self-review

1. **Can an ordinary production build silently omit `/Brepro`?** **Yes — via a preset `RUSTFLAGS` environment variable**, which Cargo lets replace config flags outright. Not fixable in configuration; documented in the config file and here. B2/B3 catch the *committed* contract being weakened, not a polluted shell.
2. **Can a developer bypass it accidentally?** Yes, two ways: exported `RUSTFLAGS`, or running cargo from a directory above `service-host` so the config is not discovered. Both are recorded; neither is repairable by this phase's boundary.
3. **Did the implementation change the feature graph?** No — §5, resolver output identical.
4. **Did it enable live IPC where previously absent?** No. `windows-live-ipc` was already supplied by the committed manifest; nothing was added.
5. **Did it add a dependency or package indirectly?** No — `cargo metadata` clean, lockfile restored and unchanged.
6. **Did environment-only local configuration become required?** No — the contract is committed. The `RUSTFLAGS` concern is the inverse: environment can *break* it, not enable it.
7. **Are both outputs truly full-file identical?** Yes — byte-by-byte across all 320,000, not a sampled or section-wise check.
8. **Did either build consume residue from a prior target directory?** No — `det-a`, `det-b` and `det-c` were fresh roots, each created empty for this phase.
9. **Did a mutation remain?** No — all four restored byte-identically (`cmp`), validator PASS, tree shows only the three implementation paths.
10. **Was the installed binary or service touched?** No — §10.

---

## 10. Machine non-interference

Before and after, read-only: service `Stopped` / `Manual` / `DEMAND_START`; installed path unchanged; installed SHA-256 `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` **unchanged**; F1 security descriptors unchanged; ProgramData untouched; no ProjectOSHost process; no service-owned pipe; no credential or provider operation. The service was never started.

---

## 11. Review stack

**USED** — Cargo/build-contract review, deterministic-build review, repository-boundary review, feature-graph non-regression review, installed-binary non-interference review, secret scan, Claude adversarial self-review (which produced §9 and caught both the crude mutation-2 and the `RUSTFLAGS` bypass).
**AVAILABLE BUT NOT APPLICABLE** — ECC review agents (no application code changed; this is a build-contract and records phase), Obsidian.
**NOT APPLICABLE** — UI UX Pro Max, Flow Motion, Figma.
**PROHIBITED** — Provider MCP; not invoked.

---

## 12. Residual risks

1. **`RUSTFLAGS` env override** — the one real bypass. Mitigation would need a wrapper script or CI enforcement, both outside this boundary.
2. **cwd sensitivity** — `.cargo/config.toml` is only discovered at or below `service-host`. With no workspace, you must `cd` there anyway, but a future workspace would change that.
3. **No CI exists** to run the contract on every change; the validator runs only with `validate-all`.
4. **The installed binary is still the pre-`/Brepro` artefact** and remains unsigned. Determinism is the prerequisite for meaningful signing, not a substitute.

---

## 13. Programme position

`acceptedPhaseCount` **4 / 19**, **21.1**, `EXECUTION_READY` **false**, `installationAuthority` **NotAuthorised**. F1 CLOSED; service-start compatibility CLOSED; build-provenance records correction CLOSED. **F2, F3, F4, F5 remain OPEN. C4, C6 OPEN; C7 OPEN / PROHIBITED.** No numbered V3 phase closes from this work.

This phase does **not** replace the installed binary, does **not** ship custody, does **not** complete F2–F5, does **not** authorise C7, and does **not** make `EXECUTION_READY` true.

---

## 14. Decision requested

**ACCEPTED — DETERMINISTIC BUILD PROVENANCE CAPTURED**

Two independent clean builds of ProjectOSHost are now byte-identical across all 320,000 bytes through a committed contract of one linker flag and one alias, enforced by a seven-assertion validator that all four frozen mutations kill for their named reasons. No feature, dependency, package or lockfile changed, and the installed service was never touched.

Three things are yours to weigh: the two frozen-contract interpretations in §1, and the `RUSTFLAGS` bypass in §12 — which I could not close inside this boundary and did not pretend to.
