# PROJECTOS-RECOVERY-INSTALLED-APP1A — Evidence Pack

> Status: IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure is owner-gated.

1. **Project:** ProjectOS
2. **Phase:** PROJECTOS-RECOVERY-INSTALLED-APP1A
3. **Date:** 2026-08-15
4. **Branch / HEAD:** `projectos-post-v3-selfhost-pilot1a`. Evidence subject **`cab71a5dfd63e22c9c0b0ee23609f2245d5eb81a`** — the commit that was signed, packaged, installed and proven live. The earlier 3d5a90e release was superseded: G4-12 correctly called its evidence stale once cab71a5 changed source after it, so the release was RE-CUT at cab71a5 rather than rebinding evidence to bytes that were never installed.
5. **Files changed:** The evidence subject `cab71a5` changed 7 files (+813 / −10) versus its parent `3d5a90e`: `core/src/closureDecision.ts`, `core/src/closureEligibility.ts`, `agent/src/closureGate.ts`, `agent/src/commands/phase.ts` and three core test files — the owner-accepted-HIGH mechanism and its tests. Nothing else.
6. **Summary:** The normal installed application performed the whole owner workflow on the existing Windows host and trust architecture. The owner signed the canonical trust manifest with the existing P-256 key; the signature verified against the public point compiled into `anchor.rs`, with four negative controls rejected — including the earlier 3d5a90e signature, which does not verify this subject. One x64 MSI was built and installed once, and the installed executable matched the MSI-embedded binary byte-for-byte. The app ran non-elevated from the real Start Menu shortcut, drove one packaged daemon over a fixed Git route with no PATH fallback, and showed live governed truth on every surface.
7. **Validators:** `validate-all` 129 registered modules, 129 PASS, 0 FAIL, ALL PASS, exit 0 — run before installation and again after, same result. `validate-no-secrets` exit 0. Release validators `val-projectos-release-workspace-freshness1a`, `val-projectos-packaged-runtime-contract1a`, `val-cd-b4-release-currentness1a`, `validate-host-identity-boundary` each exit 0. Core 264 passing, agent 375 passing, core typecheck and agent `typecheck:all` exit 0, `git diff --check` exit 0. **Subject-bound validator run recorded:** `.projectops/validation/cab71a5dfd63e22c9c0b0ee23609f2245d5eb81a.json`, 14,154 bytes, sha256 `21d6b9f169cd316f2669017610e63a3b165a86d2d9ea2d38d616b2042cb872e0` — 129/129, exit 0, `aggregatePassed: true`, clean at run start.
8. **Secrets used?** No. No secret was read, written or transmitted. The owner's signing key was never accessed by this agent; the owner ran the signing block, and only the detached signature and the public point were consumed.
9. **Gated actions performed?** Two owner-approved local installations, each SHA-256-pinned under its own explicit gate: the 3d5a90e release `5b45890f…c27aa`, then the cab71a5 re-cut `ddbc7d99…12df5` which replaced it. No production, deployment, database mutation, external send, payment, credential access or secret storage. No service installed or started.
10. **Risks / carry-forward:**
    - **SR-1 (HIGH, unresolved, owner-accepted):** the signed trust manifest covers the packaged Node runtime and daemon bundle but **not** `projectos-control-center.exe`, and that executable is not Authenticode-signed. Murad explicitly accepted this for local recovery closure only — it is not fixed, not downgraded, and grants no production or external-distribution approval.
    - No ProjectOS command writes the closure-evidence record; this pack and the record were hand-authored under a one-time Phase 5 exception.
    - `validate-all` cannot be pointed at a subject other than `HEAD`; the G4-17 record was produced by running it inside a detached worktree at `cab71a5`.
    - The repository has **no `.gitattributes`** while `core.autocrlf=true`, so a fresh worktree materialises CRLF and five checks pinned to LF bytes fail until the affected files are restored.
    - The `core` package has no test-typecheck while `agent` has one.
11. **Decision needed:** owner/advisor review + closure.

## Release identity

| | |
|---|---|
| evidence subject | `cab71a5dfd63e22c9c0b0ee23609f2245d5eb81a` |
| buildId | `cab71a5dfd63` |
| canonical subject | 713 bytes, sha256 `97f6c6790e00dfec6f5d6313cb67c1cbb58ecbb82f7c70bcb64a119570bd472f` |
| signing key | `projectos-signing-20260812`, ES256, IEEE-P1363 raw r‖s |
| MSI | `ddbc7d995663d7884d824a797dc602b08e4fae647922607f840cc7dfade12df5`, 37,224,448 bytes |
| ProductCode | `{88893E5E-0AB9-4DA7-A6D8-A74967DC2622}` |
| UpgradeCode | `{E0D5D7AF-3631-53BF-9085-BE20BB8B99F7}` |
| installed exe | `62268271d75cab9ba2eadbb7f5ab1b59f148cc3d6a054c3a628ddc4ee708a12b` |
| daemon | `c5fcacc513e8575e79135d00dabec94df2943bc8f151821ef0a7d7d247c65f38` |
| packaged Node | 24.14.1, `58e74bf02fc5bbacc41dcb8bef089961cd5bddd37830b87784e4fc624d145d1f` |

## Headed / desktop proof — performed against the INSTALLED application

- Installed once, `msiexec /qn /norestart`, exit 0, no reboot pending, no FilesInUse. Major upgrade removed the prior product; exactly one product registered afterwards.
- Installed executable **identical** to the MSI-embedded binary.
- Launched from the real Start Menu shortcut as the normal user: **MEDIUM integrity**, parent `explorer.exe`, one process.
- Exactly **one** daemon, from the packaged runtime, with an explicit `--root`. Daemon environment held three variables only, including `PROJECTOS_GIT_EXE` bound to one absolute `git.exe`; **no PATH**, so no other git was resolvable.
- Owner Control on live governed truth: 4 of 6 phases accepted, 66.7%, plan READY (recomputed), IN EXECUTION, and Phase 5 correctly shown as **awaiting closure** with *"Closure authority is ChatGPT. The implementer (Claude Code) cannot close a phase."*
- All six lifecycle labels and the stage-only note ship in the packaged bundle; none of the four superseded imperatives appears. At `awaiting_closure` the note is correctly **absent** and no stage button is offered — `NEXT_STEP` has no entry for that state because the only remaining action is owner-gated closure. **"Close as ChatGPT" was NOT pressed.**
- Owner Chat live; Safety showed provider guards REFUSED / production-frozen; objective entry, plan-proposal and activation surfaces present and truthful.
- Restart and recovery clean; daemon exited with the app and one daemon returned on relaunch.
- Stale-claim sweep across all nine routes: **NONE**.
- **No plan activated. No governed state-changing control pressed.**

Limits stated rather than implied: `aria-describedby` could not be confirmed through WebView2's UIA bridge (it leaves `HelpText` empty) and is proven by the focused test instead; only one lifecycle label is observable at a time because the label follows phase status, so the other five are proven by test and by the packaged bundle.

## Reviews and findings

Code, security and ECC reviews complete. **0 CRITICAL. 1 HIGH (SR-1), unresolved and owner-accepted.**

The subsequent G4-10 correction was reviewed three times; one CRITICAL, four MEDIUM and one LOW were raised and every one fixed, ending at zero CRITICAL / HIGH / MEDIUM. Self-review additionally found a negative-count hole that would have hidden a CRITICAL. 34 mutations were killed with 4 controls passing.

## Final status
**PROJECTOS-RECOVERY-INSTALLED-APP1A — AWAITING-REVIEW.**
