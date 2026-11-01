# PROJECTOS-TENANT-CSP1A — evidence

**Phase:** PROJECTOS-TENANT-CSP1A, phase 5 of V4 Stage 2, plan v1.31. Owner decision D6: "Approve strict policy
(Recommended)".
**Branch:** `projectos-tenant-csp1a`, from `b0768486`.
**Route:** built by a Claude subagent in its own worktree, under the lead. This document claims no gatekeeper ruling
and no closure. The required ECC SECURITY review has not happened yet.
**Boundary:** debug builds only. No MSI, no release build, no install, no service, no ACL or registry change, no
deployment, no push. One request went to Supabase, described below.

**The installed app gets this policy only when the MSI is next rebuilt.** That rebuild is blocked today by a defect
this phase found, described next. Until it is fixed, the policy protects nothing an owner actually runs.

## The blocker this phase found

`npm run build` fails at `b0768486`, with or without this phase. No frontend bundle can be built from `main`, so no
MSI can be either.

1. `candidateEvidence.ts` imports `isUtf8` from `node:buffer`, and `vite.config.ts` aliases only `node:crypto`. Rollup
   stops with `"isUtf8" is not exported by "__vite-browser-external"`.
2. With that aliased, the build succeeds and the window is blank. `hostReviewWire.ts` runs `Buffer.from` at load time
   in three constants (lines 24, 61 and 305), and the `@projectos/core` barrel pulls it into the bundle. The webview
   console says `ReferenceError: Buffer is not defined`. This phase saw that blank window for real.

**The fix, which is outside this phase's write paths:** a `node:buffer` alias and stub in `vite.config.ts` and
`src/shims/`, and those three constants made lazy in `core/src/hostReviewWire.ts`, or a browser entry for `core`
that leaves the host-review modules out. No new dependency. It needs a plan write-path grant from the owner and a
small phase, and it must land before the next MSI. It costs about an hour, and a real webview run should prove it.

The proof carries its own stand-in so it could run at all: `test/csp-webview/vite.proof.config.ts` and
`nodeBufferStub.ts`. They reach proof builds only, and they are not that fix.

## What changed

**The policy** (`src-tauri/tauri.conf.json`, `app.security.csp`) is the delta's exact target with `style-src`
tightened:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
connect-src 'self' ipc: http://ipc.localhost https://vzbzkziksxvyfqrdrwqx.supabase.co
wss://vzbzkziksxvyfqrdrwqx.supabase.co; object-src 'none'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'
```

**`style-src` tightened: `'unsafe-inline'` is gone from the built app.** It runs without it, proved in the webview.
Vite extracts the CSS to a file, and React writes a `style` prop through the CSSOM, which `style-src` does not
restrict. The run shows both halves: an injected `<style>` and a `style` attribute are refused, and a CSSOM write
works. The source has no route that writes inline style as markup, and validator rule CSP-11 keeps it that way.

**`devCsp`** is that policy plus the two things Vite needs: `'unsafe-inline'` in `style-src`, and
`ws://localhost:5178`. `tauri dev` serves pages from Vite, so `devCsp` is not applied there. On the desktop Tauri 2.11.5
loads `devUrl` directly and only its own asset protocol sets the header, so `devCsp` applies only to pages Tauri
serves. Making dev mode enforce a policy needs `server.headers` in `vite.config.ts`, outside this phase's write paths,
and Vite's own inline preamble would have to be allowed for. The strict string was run as the served policy
(`dev-policy-shell`), which proves it does not blank the built app. It does not prove anything about Vite.

**The window capability** (`capabilities/default.json`) went from `core:default`, `core:event:default`,
`opener:default` and `opener:allow-open-url` to exactly `core:event:allow-listen` and `core:event:allow-unlisten`.

| Removed | Why it was not needed | Proof nothing needed was lost |
|---|---|---|
| `core:default` (window, webview, app, path, menu, tray, image, resources) | The frontend imports only `@tauri-apps/api/core` and `/event`, and calls no `plugin:` command by name | Source scan in `cspPolicy.test.ts` and rule CSP-10; five screens walked; sidecar round trip through `listen` and `unlisten` under the narrowed list |
| `core:event:default` (adds emit) | The window never emits; Rust does | As above |
| `opener:*` | Nothing imports `@tauri-apps/plugin-opener`, and no link has `target="_blank"`. The "ChatGPT hand-off" in the old description no longer exists in the source | Same scan. A call to `plugin:opener\|open_url` is now refused |

App commands such as `daemon_status` are not gated by this list, because the app defines no command manifest. The
narrowing is about plugin and core commands. `tauri_plugin_opener::init()` stays in `app.rs` and `Cargo.toml`, unused
and now unreachable from the window. Removing it is a LOW, outside this phase's write paths.

## The webview proof

**Route.** Real WebView2 (`Edg/156`) on the debug executable, driven over the Chrome DevTools Protocol. No msedgedriver
was needed or installed, and no WebDriver feature is compiled in. The proof build adds a loopback debug port through
`additionalBrowserArgs` in a `--config` merge, because wry's explicit browser arguments override
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`. `tauri.conf.json` never carries it, and rule CSP-7 refuses it there. A
private `WEBVIEW2_USER_DATA_FOLDER` kept the runs away from any installed profile.

The harness reloads once attached, with a violation listener in place before the document, so a violation during
boot is seen. It reads the browser's own log as well.

**Two builds, because the shell sits behind a session and this proof has no password.** `strict-shell` has no Supabase
settings, so the auth gate is off and the real shell mounts. `strict-login` has them, so it stops at the sign-in screen.
Both carry the identical policy. The shell behind a real session was not run.

| Run | Result | What it shows |
|---|---|---|
| `strict-shell` | Pass, all 19 checks | App rendered; sidecar `RUNNING_READ_ONLY` with real messages back; IPC over `http://ipc.localhost`, with no fallback; five screens walked; bundled woff2 fetched with status 200, and text measures differently from a fallback font; zero violations in normal use |
| `strict-login` | Pass, all 6 checks | Sign-in screen rendered; fonts; one failed sign-in at the exact host; zero violations |
| `dev-policy-shell` | Pass | `devCsp` as the served policy does not blank the built app |

**Deliberate violations, blocked in `strict-shell`:** inline script, `eval`, fetch to another host, fetch to a sibling
`*.supabase.co` project, foreign image, `<style>` element, `style` attribute, `<base>`, `<object>`, form submit. Each counts
only with both halves: no effect, and the browser reporting the expected directive. A local listener recorded what arrived:
nothing.

**A proof counts only if removing its rule makes it fail.** Each control below removes one rule, built with a `--config`
merge, and passes only by failing at its named check while still passing what it should leave alone.

| Control | Removes | Fails at | Still passes |
|---|---|---|---|
| `control-no-policy` | The whole policy | `served-policy`, and every probe: the inline script and `eval` ran, and the fetch, image, object and form reached the listener. The sibling-project probe is skipped on purpose, because here it would really reach Supabase | App, fonts, sidecar |
| `control-loose-script-style` | Adds `unsafe-eval` and `unsafe-inline` | `eval-blocked`, `inline-style-blocked`, `style-attribute-blocked` | `inline-script-blocked`, see the first note |
| `control-no-ipc` | `ipc:` and `http://ipc.localhost` | `no-violation`, `ipc-native` | Sidecar, through Tauri's silent `postMessage` fallback |
| `control-no-fonts` | `font-src` | `bundled-fonts` | App, sidecar |
| `control-no-script` | `script-src`, with Tauri's asset modification off for that directive | `app-loaded`: a blank window with no sidecar, no fonts and nothing rendered | Served policy |
| `control-no-supabase` | Both Supabase sources | `supabase-reached`. The real client tried the exact URL and the policy refused it; zero requests left | App, fonts |
| `control-wide-capability` | The narrowed capability | `capability-narrow` | App, sidecar |

Three notes from those runs:

- **`'unsafe-inline'` in `script-src` is inert here.** Tauri adds one `sha256` hash per bundled `.js` file to the served
  `script-src`, and a browser ignores `'unsafe-inline'` once a hash is present. That control was first written to fail at
  the inline script, and it did not, so it now names `eval-blocked`. The observation did not change, only the expectation.
- **Tauri's script hashes admit only bytes the app already ships.** The served `script-src` is the committed one plus
  three hashes, and the comparison allows them there and nowhere else. Tauri also puts `'self'` back beside them, so
  `script-src 'none'` alone cannot blank the app. That is why `control-no-script` has to switch the modification off.
- **`ipc:` failure is silent in the app.** Without those sources the app still works through `postMessage`, so only
  `no-violation` and `ipc-native` can see it.

## The one Supabase request

An invented address (`csp-proof-no-such-user@example.com`) and a random password, through the real form. Sign-ups are off,
and a password grant creates nothing. `POST https://vzbzkziksxvyfqrdrwqx.supabase.co/auth/v1/token?grant_type=password`
returned `400`, and the app showed "Invalid login credentials". A latch file written before the click refused any repeat.

**The wire shows two HTTP exchanges for that one sign-in:** the POST, and the browser's automatic CORS preflight to the
same URL. No other request went to the host. The sign-in path was rehearsed against `control-no-supabase` first, and
`.env.local` was read by the build script only, with no value printed or stored. The anon key is in the bundle, as it
always is, and every proof build was deleted afterwards.

**A successful sign-in remains an owner check.** This proves the app can reach the exact host under the policy and read
the reply. It does not prove a session, or the shell behind one. Owner's check, about a minute, after the next MSI: sign in
once and see the shell. Any session work afterwards goes over the same `connect-src` entry.

## What this does not prove

- The `wss://` source is allowed by the policy and was not exercised. No screen uses realtime, and a socket would have been a
  second request.
- `frame-ancestors` was not exercised: the app is a top-level window and nothing frames it. The header is served.
- Project screens were not rendered: the proof ran with no governed project, so the shell walk covers the rail's five
  destinations in their empty state. Rules CSP-10 to CSP-12 and the `cspPolicy.test.ts` scans cover the rest of the source
  statically.
- A release build. The proof binary is the debug profile, with the debug port, without the MSI resources, and with the proof
  Vite config. `generate_context!` embeds the same policy either way, but the MSI itself has not been run.
- The WDIO desktop E2E under the new policy. Its plugin runs top-level scripts through `ExecuteScript`, which a page's CSP does
  not govern, and uses `eval` only inside frames, which the app does not have. So it should still work, but it was not run.

## Defects the proof found in itself

Each is fixed, and each is now a rule or a test.

- **A blank window counted as a control failing.** `control-no-supabase` reported proved while the window sat on `about:blank`.
  A control must now also pass what it should leave alone (`mustStillPass`). Mutation "a blank window counts as a control
  failing", and a named test.
- **The reload could cancel the app's own first navigation,** leaving `about:blank`. It now waits for the first load. Mutation
  "the reload no longer waits for the first load".
- **The reload aborts in-flight IPC,** which logs Tauri's fallback line. Only a line from before the new document commits is
  excused, and the positive check `ipc-native` shows the new document used the custom protocol. No passing run in the
  evidence relies on the excuse: its count is 0 in all three.
- **A WebView2 browser outlived `taskkill /T`,** so a helper stayed alive. The harness now stops whatever names its own profile
  and checks that nothing remains, by profile and never by name. Two later runs of `control-no-fonts` were refused by that
  check. The error did not then name the holder, it now does, and the next run passed, so the cause is unknown. Nothing was
  alive when checked afterwards, and that control's final record comes from the run that passed.
- **The font record overstated:** a CSP-blocked file appears in Resource Timing with status 0, and it was recorded as fetched.
  Only status 200 counts now, and that control was rerun.

## Validators and tests

- `val-projectos-tenant-csp1a`, registered in `validate-all` and `cached-runner`: 20 rules plus CSP-T, with 57 named
  mutations, each killed by its own rule. CSP-16 binds the evidence file to the hashes of the policy and capability, so
  changing either makes the evidence stale.
- `projectos/control-center/test/cspPolicy.test.ts`: the policy, the source scans, and the judge, including that silence never
  passes.
- `docs/finish/PROJECTOS-TENANT-CSP1A.webview-evidence.json`: one record per run, with no console text, header or body.

- Control-center suite, run once: all 921 tests passed, including this phase's. One file, `offLoopGovernedCommand.test.ts`,
  which this phase did not touch, reported an `afterAll` temp-folder failure under full-suite load; rerun alone it passed
  7 of 7. `tsc` is clean.
- Every validator reading a touched file passed: `validate-no-secrets`, `val-projectos-tenant-contract1a`,
  `val-projectos-tenant-rls1a`, `val-projectos-packaged-runtime-contract1a`, `val-projectos-v3-webdriver-e2e-isolation1a`,
  `val-projectos-v3-validation-evidence1a`, `validate-speed-validation-cache`, `val-projectos-kernel-followup1a`,
  `val-projectos-host-review-path1b`, `val-projectos-session-router1a`, `val-projectos-credential-vault1a`,
  `val-projectos-validator-scratch-lifecycle1a`, `val-projectos-release-workspace-freshness1a` and
  `val-projectos-v3-active-phase-consistency1a`.
- **`validate-desktop-e2e` needs a built bundle, and fails closed without one.** It passed against a throwaway bundle made
  through the proof config, which was then removed. In a checkout with no `dist`, it fails at check 5. Because `npm run build`
  fails at `b0768486`, a fresh `validate-all` cannot pass that check until the bundle defect is fixed. That is a consequence
  of the defect, not of this phase.

Full `validate-all` was not run, by instruction: the lead runs it.

## Running it again, and disk

```
node test/csp-webview/build-variant.mjs <variant>
node test/csp-webview/run-proof.mjs <variant> --out <file> [--live-sign-in]
node test/csp-webview/collect-evidence.mjs <runs-dir> <evidence-file>
```

Run these from `projectos/control-center`, after `npm run build:sidecar`, and set `CSP_PROOF_ENV_FILE` for the `login`
variants. Without `--live-sign-in` nothing goes to Supabase. **The latch lived in the target directory, which is now
gone, so a rerun with that flag is a new request and a new decision.**

Disk: 3.5 GB at peak against a limit of 8 GB, including a private `CARGO_HOME`, so `~/.cargo` gained nothing. Free space
stayed above 12 GB throughout. `src-tauri/target`, `dist`, `node-build` and `src-tauri/gen` were removed when finished, and
nothing later needs them. `Cargo.lock` was restored. No msedgedriver or other tool was installed.

## Carried, not done

- **The bundle defect above. It blocks the MSI.** Owner grant, then a small phase.
- `src-tauri/Cargo.lock` is stale at `b0768486`: it lacks three path crates, and `cargo --locked` refuses it. A normal build
  rewrites 32 lines. Those were restored here and not committed, as the file is outside the write paths. LOW.
- `tauri_plugin_opener` stays registered in `app.rs`, unused. LOW.
- `devCsp` is not enforced under `tauri dev`, see above. LOW.
- ECC SECURITY review, required by the plan and not yet run.
