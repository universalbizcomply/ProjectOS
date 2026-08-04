# PROJECTOS-HOST-BINARY-CUSTODY-ACL-HARDENING1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOS-HOST-BINARY-CUSTODY-ACL-HARDENING1A |
| **Date** | 2026-08-05 |
| **Repository** | `C:\dev\ProjectOS` |
| **Branch** | `projectos-v3` |
| **Closes** | **F1 (CRITICAL)** from `PROJECTOS-HOST-CREDENTIAL-CUSTODY-TRANSPORT-INSTALLER-PREFLIGHT1A` |
| **Machine change** | applied, then **owner-ratified retrospectively** |
| **Decision requested** | **ACCEPTED — F1 CLOSED** |

Records-only commit. The machine change was applied under owner authorisation and is now frozen; this report records it. No further ACL, ownership or inheritance change. No rollback executed. No service start, stop, restart or reconfiguration. No installer or updater. No ProgramData or registry mutation. No credential, provider, IPC, production, database, deployment, send or payment activity.

---

## 1. The finding this closes

The custody preflight recorded **F1** as CRITICAL and live: the installed service binary granted the ordinary Windows user `FullControl`. Because the service executes that binary **as the custody identity**, the account running Claude Code could replace the executable that C5 intends to hold production credentials.

Verified before-state, read with `Get-Acl`:

```
O:S-1-5-21-4148471965-194847017-750158596-1001
G:S-1-5-21-4148471965-194847017-750158596-1001
D:AI (A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;0x1200a9;;;BU)
     (A;ID;FA;;;S-1-5-21-…-1001)(A;ID;0x1200a9;;;AC)(A;ID;0x1200a9;;;S-1-15-2-2)
```

Two facts in those bytes decided the shape of the remediation:

1. **`MSI\murad` was the OWNER**, not merely an ACE holder. An owner carries implicit `WRITE_DAC`. Removing the ACE alone would have been cosmetic — the user could rewrite the DACL and restore their own FullControl.
2. **The ACE was `ID` (inherited)**, not explicit. It could not be removed without protecting the DACL first. `C:\Program Files` carries an inheritable `CREATOR OWNER GENERIC_ALL`; when the installing user created `C:\Program Files\ProjectOS` while elevated, that materialised as a user FullControl ACE and propagated down. **This is the default outcome of any admin-run installer that creates its own Program Files directory.**

---

## 2. Scope, and the two boundary excesses disclosed

Three objects were changed:

1. `C:\Program Files\ProjectOS\host\ProjectOSHost.exe`
2. `C:\Program Files\ProjectOS\host`
3. `C:\Program Files\ProjectOS`

**Both excesses beyond the literal original grant were disclosed at the time and have since been ratified.**

**Excess 1 — the third object.** The original boundary named the executable and its immediate parent. Hardening those two would still have left a working substitution route: renaming or replacing the `host` directory requires rights on its *parent*, `C:\Program Files\ProjectOS`, where the user held FullControl. Write access had to be removed at three levels because file write is only one of three substitution paths — the others are delete-and-recreate (needs the parent) and rename-the-parent (needs the grandparent).

**Excess 2 — ownership and group.** The grant said "ACL"; owner and group are parts of the security descriptor, not the DACL. Changing them was necessary for the reason in §1.1, and leaving them would have made the whole change ineffective.

---

## 3. Intended state, derived before mutation

Derived from Windows identity evidence and the repository's own strict ACL policy model (`windows-acl-policy`: protected DACL, no broad principal with write, fail-closed):

| | exe | host | ProjectOS |
|---|---|---|---|
| Owner / Group | SYSTEM | SYSTEM | SYSTEM |
| DACL | protected (`D:P`) | protected | protected |
| SYSTEM | FullControl | FullControl | FullControl |
| Administrators | FullControl | FullControl | FullControl |
| TrustedInstaller | *(none — see §6)* | FullControl | FullControl |
| `NT SERVICE\ProjectOSHost` | ReadAndExecute | RX, inheritable | RX, inheritable |
| `BUILTIN\Users` | ReadAndExecute | ReadAndExecute | ReadAndExecute |
| App-package principals | ReadAndExecute | ReadAndExecute | ReadAndExecute |
| `MSI\murad` | **removed** | **removed** | **removed** |
| `CREATOR OWNER` | n/a | **removed** | **removed** |

`CREATOR OWNER` was removed for the same reason as the ownership change: left in place, any future child created by the user re-materialises user FullControl.

The service SID was resolved live rather than assumed: `NT SERVICE\ProjectOSHost` → `S-1-5-80-3378865708-3397408971-155286320-2096107322-2736411702`.

---

## 4. Rollback, defined before mutation

Two independent mechanisms were created **before** anything was applied, and both were verified before use:

| Mechanism | Content | Verification |
|---|---|---|
| `rollback.ps1` | exact pre-change SDDL per object, restoring owner, group, DACL and inheritance | `Parser::ParseFile` **0 errors**; each embedded SDDL confirmed **verbatim** against the captured before-state |
| `icacls-before.txt` | `icacls /save /t /c`, 3 objects, 13 entries | re-read after write |

Supporting evidence: `before-sddl.txt`, `after-sddl.txt`, `before-exe.txt`.

**Rollback has not been executed**, and executing it would reopen F1.

---

## 5. Application

Applied deepest-first — exe, then `host`, then `ProjectOS` — following the ordering lesson already recorded in `elevated-installer-composition` (`effect.rs`), where applying a protected DACL shallowest-first can cost the applier `WRITE_DAC` on a child.

Windows canonicalised ACE order and recorded `D:PAI` rather than the literal `D:P` submitted, so a raw string comparison against the intended SDDL returns false. **Verification was therefore done semantically, not by string equality** — principal by principal, mask by mask.

---

## 6. Post-effect reconciliation — nine required proofs

### 6.1 No ordinary-user write, modify, delete, replacement, `WRITE_DAC`, `WRITE_OWNER` or ownership route — **PROVEN**

Each route was tested as a distinct right rather than assumed: `WriteData/CreateFiles 0x2`, `AppendData/CreateDirs 0x4`, `WriteEA 0x10`, `DeleteChild 0x40`, `WriteAttributes 0x100`, `Delete 0x10000`, `WRITE_DAC 0x40000`, `WRITE_OWNER 0x80000`.

On all three objects: owner is `NT AUTHORITY\SYSTEM`; **zero** ACEs name `MSI\murad`; and every ACE naming a principal a non-elevated user token can actually use returned **READ/EXECUTE ONLY**.

Closing each route explicitly — direct write: no ACE grants it. Delete or replace: no `Delete` on the file and no `DeleteChild` on either parent. Re-secure: no `WRITE_DAC`/`WRITE_OWNER`, and the implicit owner right is gone with the ownership change. Reintroduction by inheritance: all three DACLs are protected and `CREATOR OWNER` is removed.

**Token evidence, obtained without any exploit attempt.** A read-only P/Invoke probe of the *linked filtered* token (`TokenLinkedToken` → `TokenGroups`) showed, on this machine:

| Group | SID | State in the filtered token |
|---|---|---|
| `BUILTIN\Administrators` | `S-1-5-32-544` | **`DENY_ONLY=True, ENABLED=False`** |
| `BUILTIN\Users` | `S-1-5-32-545` | enabled — read/execute only |
| `NT AUTHORITY\Authenticated Users` | `S-1-5-11` | enabled — read/execute only |

No file was opened for write and no substitution was attempted.

### 6.2 Broad user groups retain read/execute only — **PROVEN**
`BUILTIN\Users` holds `0x001200A9` (`FILE_GENERIC_READ|FILE_GENERIC_EXECUTE`) and, on directories, inherit-only `0xA0000000` (`GENERIC_READ|GENERIC_EXECUTE`). Both app-package principals likewise. **No inheritable ACE grants write to any broad principal**, so future children inherit read/execute only.

### 6.3 SYSTEM, Administrators and TrustedInstaller retain recovery and servicing authority — **PROVEN, with one disclosure**

SYSTEM and Administrators hold FullControl on all three objects. TrustedInstaller holds FullControl on both directories.

**Disclosure: `ProjectOSHost.exe` has no TrustedInstaller ACE — and it had none before the change either.** The before-SDDL in §1 shows SY, BA, BU, the user, and the two app-package principals; no TI. The directory's TI ACE is `CIIO` (container-inherit, inherit-only), so by Windows design it applies to sub-directories and never to files. This is **pre-existing and not a regression**; file-level servicing and recovery run through SYSTEM and Administrators.

### 6.4 `NT SERVICE\ProjectOSHost` retains required read/execute — **PROVEN**
Explicit `0x1200a9` on all three, inheritable (`OICI`) on both directories.

The service's access is a **strict superset** of before. It previously reached the binary only transitively through `BUILTIN\Users` ← `Authenticated Users` — confirmed by enumerating `BUILTIN\Users`, whose members are `INTERACTIVE`, `Authenticated Users`, and four local accounts, with **no `NT AUTHORITY\SERVICE`**. That path was **retained**, and an explicit service ACE added on top.

### 6.5 No unrelated child object was changed — **PROVEN**
`C:\Program Files\ProjectOS` contains exactly **two** descendants — `host` and `ProjectOSHost.exe` — both intentionally in scope. No unrelated child exists, so none could have been affected. Both show owner SYSTEM, protected DACL, zero user ACEs, and original `LastWriteTime` values.

### 6.6 Executable bytes, hash, size and timestamps unchanged — **PROVEN**

| | Value | Matches before |
|---|---|---|
| SHA256 | `512820C757D53A2B82840B627E5FF20BA0AC0E32225D54E277691BEC72BB9C56` | ✅ |
| Size | 320000 | ✅ |
| LastWriteUtc | `2026-08-01T19:56:30.6025680Z` | ✅ |
| CreationUtc | `2026-08-01T20:17:16.0019525Z` | ✅ |

Re-verified again after the evidence copy in §7.

### 6.7 Service configuration and state unchanged — **PROVEN**
`TYPE 10 WIN32_OWN_PROCESS` · `START_TYPE 3 DEMAND_START` · `ERROR_CONTROL 1 NORMAL` · `BINARY_PATH_NAME C:\Program Files\ProjectOS\host\ProjectOSHost.exe` · `SERVICE_START_NAME NT SERVICE\ProjectOSHost` · `SERVICE_SID_TYPE UNRESTRICTED` · no dependencies · no load-order group · `Status=Stopped, StartType=Manual`. Never started, stopped or reconfigured.

### 6.8 No unrecorded impact on another installed component — **PROVEN**
Services with an image path under that root: exactly one, `ProjectOSHost` itself. Uninstall registry entries referencing it (read-only query): **none**. `C:\Program Files (x86)\ProjectOS`: absent. `C:\ProgramData\ProjectOS`: present and **untouched**, owner still `NT SERVICE\ProjectOSHost`, DACL protected. `%LOCALAPPDATA%\ProjectOS`: present and untouched — it holds the credential router's owner project registry, a separate trust anchor outside the changed tree. `%APPDATA%\ProjectOS`: absent.

### 6.9 Exact rollback material available outside Git — **PROVEN**
See §7.

---

## 7. Durable evidence relocation

The evidence originally lived in a session scratchpad under `%TEMP%`, which is session-scoped and may be cleaned — a durability caveat raised at reconciliation and since authorised for correction.

All five files were copied **byte-identically** into the local-only ProjectOS state root, `%LOCALAPPDATA%\ProjectOS` — the same root the session router and project registry already use (`router.cjs`, `project-registry.cjs`), and deliberately **not** ProgramData, whose mutation is prohibited:

`%LOCALAPPDATA%\ProjectOS\proof\f1-binary-acl-hardening-2026-08-05\`

| File | Bytes | SHA256 (source == target) |
|---|---|---|
| `rollback.ps1` | 2693 | `63AD26194D1A10A69BDFEF9FF702771B8DCC072C0FD5336557596933FA6D4EEB` |
| `icacls-before.txt` | 2214 | `4C4D9134B33A9325E7B6237E97128947C1EA5F5BFF05AAD64B27FF5308A12D25` |
| `before-sddl.txt` | 1434 | `98D20D1087CA23F14A68FC3F1124D6F66537C6F60C3E667285FD223D2317699D` |
| `after-sddl.txt` | 1161 | `0837E852264A5C58DCAA91A5BEAC8874923867BF66B503AF07E21DE3C2B4ECD5` |
| `before-exe.txt` | 105 | `5DCE639928A77CB03FEF9310F07739775E5E5EDD685067B5CAEB6881DD590B1B` |

Every copy verified equal by SHA256 **and** length. Originals retained. The relocated `rollback.ps1` re-parsed at its new location: **0 errors, 153 tokens**. Target is outside the Git repository and outside ProgramData.

**Post-copy verification:** the live security descriptor of each of the three objects is **string-identical** to the recorded `after-sddl.txt`, the executable hash is unchanged, and the service remains `Stopped`/`DEMAND_START`.

---

## 8. What is NOT proven

**Service-start compatibility.** Starting the service is prohibited under every gate covering this work, so the change has **not** been proven compatible with service start. The assurance is structural rather than empirical: the service's access is a strict superset of its previous access (§6.4). This remains a separately owner-gated phase.

**Resistance to an elevated administrator.** An administrator can take ownership and rewrite any of these DACLs. The repository already states this plainly — *"No service identity resists an administrator; ACLs raise the cost and make tampering evident, they do not prevent it."* F1 concerned the **ordinary** user, and that is what closed.

---

## 9. Programme position — unchanged

`acceptedPhaseCount` **4 / 19**, `completionPercentage` **21.1**, plan **v1.0**, Phase 13 CLOSED, `EXECUTION_READY` **false**, `installationAuthority` **NotAuthorised**, `86ae19c` and `a43898d` OPEN. `currentHead`/`currentRemoteHead` unchanged at the accepted baseline. This phase creates **no new accepted implementation baseline**.

Custody findings **F2** (no IPC authentication or confidentiality), **F3** (no non-elevated user→host channel), **F4** (DPAPI-under-virtual-account restart survival NOT FOUND) and **F5** (non-durable single-use grant ledger) all remain **OPEN**. Gates **C4**, **C6** and **C7** remain open, and **C7 remains prohibited** — nothing here authorises any credential activity.

---

## 10. Decision requested

**ACCEPTED — F1 CLOSED**

The ordinary Windows user now has no write, modify, delete, replacement, re-secure or ownership route to the executable the custody identity runs, proven right-by-right and corroborated by a read-only filtered-token probe; and not one byte of that executable changed. Both boundary excesses were disclosed rather than absorbed, and exact rollback exists in two independent forms, outside Git, at a durable location.

Service-start compatibility is unproven and separately gated.
