# ProjectOS — WSL2 Final Tool-Isolation Real Proof 1C — FINAL EVIDENCE REPORT

**Phase:** PROJECTOS-FORGE-WSL2-FINAL-TOOL-ISOLATION-PROOF1C
**Date:** 2026-07-13 · **Repo:** `C:\dev\ProjectOS` · **Branch:** `projectos-v3`
**END STATUS: REAL WSL2 WORKER PROOF PASSED — AWAITING CHATGPT PUSH/CLOSURE GATE**
Not pushed. Remote frozen `4c3f076`. No owner data accessed. No third-party connector invoked.

## 1. Baseline
- Branch `projectos-v3`; HEAD `cc779f6` (prior WSL2 phase commit — a prior local commit exists, reported per §3); origin/projectos-v3 `4c3f076` (frozen); ahead/behind 0/37.
- Ubuntu **WSL VERSION 2** (Stopped at start), default user `projectos-worker`, automount off, interop off. Claude Code **2.1.207**, resolved binary sha256 `85e7e988a392d859f90802ca21fb26e89d3c9ab527f5ed0b08df3955e34d5c83`.
- ECC agents + UI-UX-Pro-Max available; **Claude Design UNAVAILABLE** (frontend-design equivalent; not fabricated).

## 2. Accepted WSL2 containment (unchanged, re-verified this phase)
Non-root/no-sudo `projectos-worker`; `/mnt/c` not mounted; no drvfs/9p Windows-drive mount; no Windows PATH; `cmd.exe`/`powershell.exe` unreachable; `/root` denied; canonical `C:\dev\ProjectOS` unreachable; sandbox executable identity verified.

## 3. The three calibration corrections (§1)
1. **Permit `Write`** — the deny that blocked run-1B's full-file rewrite is fixed; permitted tools are now exactly `Read, Edit, Write`.
2. **`~/.claude.json` classified** as an EXPECTED CLAUDE RUNTIME MUTATION (exact top-level path, mutated during the Claude process, not targeted by any tool), reported separately from unexpected home changes.
3. **Cloud/MCP/Bash/Web isolation proven** — strict empty MCP config + explicit deny-list + per-run init-event verification (below).

## 4. Detected Claude 2.1.207 policy flags (§5, read-only)
`--allowed-tools <tools...>`, `--disallowed-tools <tools...>`, `--mcp-config <configs...>`, **`--strict-mcp-config`** ("Only use MCP servers from --mcp-config"), `--output-format` (stream-json), `--permission-mode`, `--settings`. No unsupported control was assumed.

## 5. MCP / cloud-tool preflight (§6)
One no-tool preflight with `--strict-mcp-config --mcp-config <empty {"mcpServers":{}}>` + a zero-file prompt. Result (exit 0, `PREFLIGHT-OK`): **mcp_servers loaded = 0**, **mcp__ tools in registry = 0**, **Bash/WebFetch/WebSearch/Task/Workflow = absent** from the registry, **no tool invoked**. → §6 condition **A** satisfied (no MCP/cloud tools in the effective surface). This directly closes the PROOF1A material finding (the owner's connectors are excluded, not merely un-invoked).

## 6. Final permitted / denied tool policy (§7)
ProjectOS builds the argv (`wsl2-provider.buildArgv`): `--print --output-format stream-json --verbose --strict-mcp-config --mcp-config /tmp/projectos-empty-mcp.json --permission-mode acceptEdits --allowed-tools Read Edit Write --disallowed-tools Bash Shell WebFetch WebSearch Workflow Task TaskCreate TaskGet TaskList TaskOutput TaskStop TaskUpdate Git SendMessage PushNotification RemoteTrigger CronCreate CronDelete CronList ScheduleWakeup DesignSync Skill ToolSearch Monitor EnterWorktree ExitWorktree NotebookEdit -p <prompt>`. Invocation record (evidence): executable path + hash + version, argvHash, permitted/denied tools, MCP isolation mode, operationId, workspaceId.

## 7. Path-scope evidence (§8)
Every tool_use path is canonicalised (`canonPath`, resolves `./`/`../`) and checked in-workspace (`pathInWorkspace`); Write/Edit target must equal the designated file; the workspace is verified to contain **no symlinks** (lexical scope cannot be escaped via a symlink). Final run transcript: `Read(<ws>/app/projectos-real-proof.txt)`, `Write(<ws>/app/projectos-real-proof.txt)` — **scopeViolations = []**, **nonPermittedInvoked = []**.

## 8. Home-runtime accounting (§9)
Whole-`$HOME` diff (excluding Claude runtime dirs). Result: `runtimeMutations = [".claude.json"]` (classified as EXPECTED CLAUDE RUNTIME MUTATION — not targeted by any tool), `unexpectedHomeChange = []`. No authentication contents were read or reported.

## 9. Final real proof (§10) — WSL2-PROOF-1C-HARDENED
Single harmless proof; the worker rewrote only `app/projectos-real-proof.txt` to the exact required five-line content (deterministic sha256 match). exit 0, 20.9s.

## 10. Pass conditions (§11) — 31/31 PASS
wsl2Active · windowsDrivesUnmounted · windowsInteropDisabled · noWindowsPath · workerIsProjectosWorker · workerNoSudo · canonicalRepoUnreachable · rootStoreDenied · sandboxExecutableIdentityVerified · **initEventObserved** · **strictMcpConfigApplied** · **effectiveCloudToolIsolationProven** (mcpServers 0, no mcp__/dangerous tools) · **allowListIsExactlyReadEditWrite** · **dangerousToolsAbsentFromRegistry** · **onlyPermittedToolsInvoked** (allow-list, not denylist) · everyFilePathWithinWorkspace · **noSymlinkInWorkspace** · onlyDesignatedFileWritten · expectedDeterministicContent · claudeJsonClassifiedAsRuntime · noUnexpectedHomeMutation · operationExited · operationExitedClean · workspaceDisposed · residueAccounted · distroTerminated · **noSpawnErrorObserved** · distroReportsStopped · zeroRemainingProcesses · canonicalUnchanged · noOwnerDataAccessed. **evidenceHash `98474d230a029403d06e9211874ef9fb94d7f06b91c086ced517b6277f5a7628`** (`%LOCALAPPDATA%\ProjectOS\evidence\WSL2-PROOF-1C-HARDENED.json`).

## 11. Termination + cleanup + canonical (§10/§11)
`wsl --terminate Ubuntu` exit 0 → distro **Stopped**, **0 remaining processes**, no spawn error; workspace disposed, residue `[]`; WSL proof-root **0 entries**. Canonical: HEAD unchanged **by the proof** (`cc779f6` pre==post — the worker has zero repo access; independently covered by `canonicalUnreachable`), remote frozen `4c3f076`.

## 12. Validation matrix (§13)
- `validate-wsl2-provider.cjs` (pure-helper regression: injection allow-list, exact distro match, running-parse, tool-transcript, path-scope, init-event fail-closed) — **PASS**.
- `validate-claude-worker.cjs` (HARDEN1E) — **PASS (55)**.
- `npm run validate` — **ALL PASS (61)**. `git diff --check` — clean. WSL residue — **0**.
- Real proof (final, hardened) — **PASSED (31/31)**.

## 13. Full ECC findings + resolution (§4)
A security/silent-failure ECC pass on the calibration delta returned:
- **CRITICAL (F1)** — pass-checks used a **denylist**, so a non-Read/Edit/Write tool (e.g. `SendMessage`/`TaskCreate`, which are NOT `Task`/`Bash`) could be invoked and still PASS; `permittedToolsExactlyReadEditWrite` only checked the argv, never the effective registry/transcript. **Fixed** → allow-list checks: `onlyPermittedToolsInvoked` (transcript ⊆ `PERMITTED_TOOLS`), broadened `DENIED_TOOLS` to the full orchestration/scheduling/messaging family, and `dangerousToolsAbsentFromRegistry` computed against `DENIED_TOOLS`.
- **HIGH (F2)** — `parseInitEvent` failed OPEN (missing/renamed init ⇒ empty ⇒ "isolated" falsely). **Fixed** → returns `found`, and `initEventObserved` (init present + populated registry) is a required pass condition; `isolationProven` requires `found`. Regression added.
- **MEDIUM (F3)** — lexical-only path canonicalisation (no realpath) could be bypassed by a workspace symlink. **Fixed** → `noSymlinkInWorkspace` pass condition (the workspace provably contains no symlinks).
- **LOW/MED (F6)** — a swallowed `wsl.exe` spawn error could degrade a liveness check to an ambiguous `0`. **Fixed** → `terminate()` error threaded into evidence; `noSpawnErrorObserved` pass condition.
- **SOUND (F4/F5)** — `.claude.json` classification is exact + double-covered; the HEAD-diff wording corrected to "implementer-hygiene, redundant of `canonicalUnreachable`."
- Deduped `DANGER`→`DENIED_TOOLS`. The final proof was re-scored under these corrected checks and independently verified the captured run satisfies them (init observed with 26 tools; only Read+Write invoked; mcpServers 0; no workspace symlink; no spawn error).

## 14. UI UX Pro Max (§14) + Claude Design
Owner-facing states (WSL isolation · Claude auth · MCP isolation · permitted/denied tools · path scope · runtime-home mutations · proof result · termination · cleanup · canonical · one next action) are represented in the evidence's `passConditions` + `cloudToolIsolation`/`toolTranscript`/`termination` sections; the readiness/execution renderers in `owner-readiness-report.cjs` remain the offline HTML surface. No success styling is applied to any failing/blocked state. **Claude Design UNAVAILABLE** (not fabricated).

## 15. Claude self-review
Re-verified: the allow-list is the enforcement (non-allowed tools were denied in prior runs); the evidence checks are now allow-list + fail-closed; the init-event isolation is per-run and cannot fail open; path scope + no-symlink + home-diff jointly bound the worker to the one designated file; termination/disposal/residue are real; canonical is untouched. No open HIGH/CRITICAL.

## 16. Unresolved limitations (honest)
- **Trust boundary:** cloud-tool isolation is enforced by Claude's own `--strict-mcp-config`/`--allowed-tools` layer + verified from the init event — it is trust in Claude's enforcement plus per-run verification, not an OS-level block of the Anthropic API (the network is necessarily enabled for the model). The OS sandbox contains filesystem/process/mount; the Claude layer contains tools/connectors.
- **Network** is CONTROLLED-PROOF-NETWORK-ENABLED (not disabled) — required for the real worker; no general-purpose network tool is granted.
- The worker inherently holds its OWN subscription token (not the owner's Windows creds); `~/.claude/` is runtime-excluded from the home diff but any tool access to it would fail path-scope.

## 17. No-X proofs
No push; remote unchanged `4c3f076`; no production/staging; no database; no email/SMS/WhatsApp; no payments; **no MCP connector loaded or invoked** (Google Drive/Stripe/Vercel/Figma/M365/Kiwi excluded via strict-mcp-config); no Bash/Web/Task/Workflow tool invoked; **no owner data accessed**; no secret/token/OAuth/cookie recorded; no Windows drive mounted; `C:\dev\ProjectOS` never mounted into WSL; no second distribution/package installed; no Windows/WSL/firewall config change.

## 18. Change control (§15 — proof PASSED ⇒ one local commit)
Changed this phase: `projectos/bridge/wsl2-provider.cjs`, `projectos/bridge/wsl2-proof-runner.cjs`, `projectos/validators/validate-wsl2-provider.cjs`, this report, the index. Evidence JSON `WSL2-PROOF-1C-HARDENED.json` + checkpoint under `%LOCALAPPDATA%\ProjectOS\` (non-repo, non-secret; hashes referenced above). Branch `projectos-v3`; remote `4c3f076` (frozen); **not pushed**. (Exact commit SHA below the commit.)

## 19. Decision required
Owner/ChatGPT push/closure gate. The full chain is now proven end-to-end on real hardware: HARDEN1E synthetic baseline → WSL2 OS isolation → sandbox executable identity → **effective cloud/MCP/Bash/Web tool isolation** → allow-listed Read/Edit/Write → path-scoped single-file edit → clean distribution termination + disposal → canonical repo untouched → no owner data accessed. No further autonomous cycle is authorised.

**END STATUS: REAL WSL2 WORKER PROOF PASSED — AWAITING CHATGPT PUSH/CLOSURE GATE.**
