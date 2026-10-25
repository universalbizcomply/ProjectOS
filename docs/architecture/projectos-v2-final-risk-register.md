# ProjectOS V2 — Final Risk Register

> Final closure evidence for **PROJECTOS-V2-FINAL-CLOSURE-EVIDENCE1A**.
> Baseline HEAD `fba757a0ff102086b77e94df1bf15b97722019e4` (branch `projectos-v2-core`).
> Closure authority: **Murad and ChatGPT only**.

All remaining risks are **non-blocking**. No unresolved CRITICAL or HIGH risk remains.

| ID | Description | Category | Severity | Probability | Impact | Mitigation | Evidence | Closure blocker | Owner decision | Future phase |
|----|-------------|----------|----------|-------------|--------|------------|----------|-----------------|----------------|--------------|
| R1 | Edge / msedgedriver version drift on the local or CI machine | Tooling | LOW | Medium | Desktop WebDriver session can hang if driver mismatches Edge | Version-matched driver documented; resolve driver version at runtime in CI | test-desktop/README.md | NO | NO | Windows CI phase |
| R2 | tauri-driver is a community-maintained dependency | Tooling | LOW | Low | Desktop harness could rot if tauri-driver breaks | Harness is opt-in and local-only; not in build/validate | package.json opt-in scripts | NO | NO | none |
| R3 | Fixture frontend and shell build ordering (shell embeds fixture-dist at compile time) | Build | LOW | Medium | Stale bundle if shell not rebuilt after a fixture change | Documented build order; net-guard coverage map catches a stale bundle | test-desktop/README.md | NO | NO | none |
| R4 | Rare historical late-teardown desktop process | Reliability | LOW | Very low | One lingering test process after settled cleanup | pid-diff settle+retry cleanup; 0 orphans across all reliability runs | fix-login/fix-mc reliability logs | NO | NO | reliability watch |
| R5 | Windows desktop CI not implemented | Coverage | LOW | n/a | Desktop automation runs locally only | Opt-in local scripts proven; CI design recorded | closure report | NO | NO | Windows CI phase |
| R6 | Real-owner-session desktop automation not implemented | Coverage | LOW | n/a | Authenticated real-login path not automated | Isolated synthetic fixture covers authenticated-state UI; real login needs sanctioned test-auth | fixture desktop evidence | NO | YES | future auth-fixture phase |
| R7 | Populated browser live transport proof not implemented | Coverage | LOW | n/a | Browser build shows Disconnected (NullTransport) | Desktop IPC transport proven; browser fallback is intentional | tauri-ipc docs | NO | NO | future |
| R8 | Future product-repository installation risk | Governance | LOW | Low | Installing into a product repo could touch product code | Installer writes config-only .projectops; product code untouched (proven in installs) | install phase reports | NO | YES | per-project install phase |
| R9 | Future production integration risk | Governance | LOW | Low | Wiring real deploy/DB/send would touch gated actions | All such actions gated + owner-only; adapters inert | safety-gates.md | NO | YES | future integration phase |
| R10 | Documentation drift | Docs | LOW | Medium | Docs could diverge from code over time | Docs validated where structured; closure evidence dated | this register | NO | NO | none |
| R11 | Lifecycle terminology drift | Docs | LOW | Low | Status terms could diverge across surfaces | Single source of truth + lifecycle-alignment guard test | d228d04 lifecycle-alignment | NO | NO | none |
| R12 | Fixture and production isolation regression | Isolation | LOW | Low | A future change could leak fixture code into production | validate-fixture-isolation guards it (0 tokens in prod dist) | validate-fixture-isolation.cjs | NO | NO | none |
| R13 | Validator scope drift | Validator | LOW | Low | Secret scanner could over- or under-scope directories | Exact path-segment skips; negative-control proven (src/test scanned, .vscode-test skipped) | fba757a negative control | NO | NO | none |
| R14 | Desktop readiness timing regression | Reliability | LOW | Low | A future WebView slowdown could exceed the readiness timeout | Bounded 12s poll fails clearly on genuine no-render; no whole-test retry | waitRendererReady in both smokes | NO | NO | none |

**Summary:** 14 risks, all severity LOW, all closure blocker = NO. Owner-decision-required items (R6, R8, R9) concern optional future scope, not V2 closure.
