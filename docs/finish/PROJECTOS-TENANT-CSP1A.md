# PROJECTOS-TENANT-CSP1A — evidence

**Phase:** PROJECTOS-TENANT-CSP1A, phase 5 of V4 Stage 2, plan v1.32. Owner decision D6: "Approve strict policy
(Recommended)".
**Branch:** `projectos-tenant-csp1a`, on `14fa45b8`.
**Route:** built by a Claude subagent in its own worktree, under the lead. This document claims no gatekeeper ruling
and no closure. The required ECC SECURITY review has not happened yet.
**Boundary:** debug builds only. No MSI, no release build, no install, no service, no ACL or registry change, no
deployment, no push. One request went to Supabase, on the earlier build, described below.

**The installed app gets this policy only when the MSI is next rebuilt.** The rebuild is no longer blocked by the
frontend build. It has not been attempted: `npm run build` passes, and the packaging steps after it
(`release:payload`, `release:register-helper`, the bundle) were not run.

## The build defect this phase found and fixed

`npm run build` failed from 2026-09-25 until this phase. No frontend bundle could be built from `main`, so no MSI could
be either.

1. `candidateEvidence.ts` imports `isUtf8` from `node:buffer`, and `vite.config.ts` aliased only `node:crypto`.
2. With that aliased, the build passed and the window was blank, because `hostReviewWire.ts` called `Buffer.from` in
   three constants while the module loaded, and the `@projectos/core` barrel binds it into the browser bundle.

**The fix (plan v1.32):**

- `src/shims/nodeBufferStub.ts` and a `node:buffer` alias in `vite.config.ts`. The stub only throws, like its
  `node:crypto` sibling.
- `HOST_FRAME_MAGIC` is now the function `hostFrameMagic()`, and `BINDING_DIGEST_DOMAIN` the private function
  `bindingDigestDomain()`. Nothing outside the file used either.

**`INSTALLED_HOST_RUN_ID` is not lazy.** It is the one deviation from the instruction. An ES export is a value, the agent
imports it as a `Buffer` in `hostIpcTransport.ts`, and that file and the validator pinning its call are outside this phase's
write paths. So it stays a load-time constant, and it is a real `Buffer` in Node, built through a `typeof Buffer` guard so it
cannot throw in a webview, and marked `#__PURE__` so the renderer bundle drops it. The bundle scan confirms the bytes are
gone. Making it truly lazy needs a grant for `agent/src/loop/transports/hostIpcTransport.ts` and for the pin in
`val-projectos-host-review-path1a`. It is a two-line change and nothing needs it today.

**The bytes did not change.** The 31 tests over `contracts/host-review-path-vectors.v1.json`, which hold frames the real Rust
Host produced, pass unchanged. `host-wire-constants.test.ts` compares each value with its old bytes and with the Rust source,
and computes the binding digest independently from the literal domain.

**Nothing in core needs a Node global while it loads, not only this file.** `coreBrowserLoad.test.ts` bundles every module the
barrel reaches with tree-shaking off and evaluates the result in a bare context with only what a webview offers. A top-level
`Buffer`, `process`, `global`, `__dirname` or `setImmediate` placed beside the barrel fails it, by name. Rule CSP-22 holds the
same line statically over every file in `core/src`.

In the production bundle, the scan finds no bare use of a Node global. Four guarded uses remain, each read in place: React's
scheduler choosing a timer (`setImmediate`), supabase-js choosing an encoder (`Buffer.from`), and two `process` reads behind
`typeof process`. The page itself reports `Buffer`, `process`, `global`, `require` and `setImmediate` as `undefined`, so an app
that renders is proof nothing needed one.

### Proved from a clean checkout, with no shim

**`node_modules/@projectos/core` in this worktree links to another worktree, so a build here would not have used this phase's
core.** The proof therefore ran in a fresh `git clone` with its own `npm ci` for `core`, `agent`, `bridge/daemon` and
`control-center`. The clone's only content difference from the commit is the stale `Cargo.lock` noted below.

| Step in the clone | Result |
|---|---|
| `validate-desktop-e2e` with no bundle | Fails at check 5, by design |
| `npm run build` with the `node:buffer` alias removed | Fails, naming `isUtf8` |
| `npm run build` as committed, with nothing extra | Passes |
| `validate-desktop-e2e` on that real bundle | Passes |

**`validate-desktop-e2e` cannot pass in a fresh worktree until a bundle is built.** Check 5 reads `dist/assets`, `dist` is
gitignored, and the check fails closed by design. So a fresh `validate-all` needs `npm run build` first. That now works, which
it did not before, but it is still a step someone has to run. `control-center/package.json`'s `build` needs `core` built first
too. This phase did not change that check.

## What changed for the policy

**The policy** (`src-tauri/tauri.conf.json`, `app.security.csp`) is the delta's exact target with `style-src` tightened:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
connect-src 'self' ipc: http://ipc.localhost https://vzbzkziksxvyfqrdrwqx.supabase.co
wss://vzbzkziksxvyfqrdrwqx.supabase.co; object-src 'none'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'
```

**`style-src` tightened: `'unsafe-inline'` is gone from the built app.** It runs without it, proved in the webview. Vite
extracts the CSS to a file, and React writes a `style` prop through the CSSOM, which `style-src` does not restrict. The run
shows both halves: an injected `<style>` and a `style` attribute are refused, and a CSSOM write works. The source has no route
that writes inline style as markup, and rule CSP-11 keeps it that way.

**`devCsp`** is that policy plus the two things Vite needs: `'unsafe-inline'` in `style-src`, and `ws://localhost:5178`.
`tauri dev` serves pages from Vite, so `devCsp` is not applied there. On the desktop Tauri 2.11.5 loads `devUrl` directly and
only its own asset protocol sets the header, so `devCsp` applies only to pages Tauri serves. Making dev mode enforce a policy
needs `server.headers` in `vite.config.ts`, and Vite's own inline preamble would have to be allowed for.
`dev-policy-shell` runs the string as the served policy, which proves it does not blank the built app. It proves nothing about
Vite.

**The window capability** (`capabilities/default.json`) went from `core:default`, `core:event:default`, `opener:default` and
`opener:allow-open-url` to exactly `core:event:allow-listen` and `core:event:allow-unlisten`.

| Removed | Why it was not needed | Proof nothing needed was lost |
|---|---|---|
| `core:default` (window, webview, app, path, menu, tray, image, resources) | The frontend imports only `@tauri-apps/api/core` and `/event`, and calls no `plugin:` command by name | Source scan in `cspPolicy.test.ts` and rule CSP-10; five screens walked; sidecar round trip through `listen` and `unlisten` under the narrowed list |
| `core:event:default` (adds emit) | The window never emits; Rust does | As above |
| `opener:*` | Nothing imports `@tauri-apps/plugin-opener`, and no link has `target="_blank"`. The "ChatGPT hand-off" in the old description no longer exists in the source | Same scan. A call to `plugin:opener\|open_url` is now refused |

App commands such as `daemon_status` are not gated by this list, because the app defines no command manifest. The narrowing is
about plugin and core commands. `tauri_plugin_opener::init()` stays in `app.rs` and `Cargo.toml`, unused and now unreachable
from the window. Removing it is a LOW, outside this phase's write paths.

## The webview proof

**Route.** Real WebView2 (`Edg/156`) on the debug executable, driven over the Chrome DevTools Protocol, on the real production
bundle. No msedgedriver was needed or installed, and no WebDriver feature is compiled in. The proof build adds a loopback debug
port through `additionalBrowserArgs` in a `--config` merge, because wry's explicit browser arguments override
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`. `tauri.conf.json` never carries it, and rule CSP-7 refuses it there. A private
`WEBVIEW2_USER_DATA_FOLDER` kept the runs away from any installed profile.

The harness reloads once attached, with a violation listener in place before the document, so a violation during boot is seen.
It reads the browser's own log as well.

**Two frontend builds, because the shell sits behind a session and this proof has no password.** `strict-shell` has no Supabase
settings, so the auth gate is off and the real shell mounts. `strict-login-no-request` has them, so it stops at the sign-in
screen. Both carry the identical policy. The shell behind a real session was not run.

| Run | Result | What it shows |
|---|---|---|
| `strict-shell` | Pass, all 20 checks | App rendered, 74 elements; no Node global on the page; sidecar `RUNNING_READ_ONLY` with real messages back; IPC over `http://ipc.localhost`, with no fallback; five screens walked; bundled woff2 fetched with status 200, and text measures differently from a fallback font; zero violations in normal use |
| `strict-login-no-request` | Pass, all 6 checks | Sign-in screen rendered; fonts; zero violations; nothing reached Supabase |
| `dev-policy-shell` | Pass, all 20 checks | `devCsp` as the served policy does not blank the built app |

**Deliberate violations, blocked in `strict-shell`:** inline script, `eval`, fetch to another host, fetch to a sibling
`*.supabase.co` project, foreign image, `<style>` element, `style` attribute, `<base>`, `<object>`, form submit. Each counts only
with both halves: no effect, and the browser reporting the expected directive. A local listener recorded what arrived: nothing.

**A proof counts only if removing its rule makes it fail.** Each control below removes one rule, and passes only by failing at its
named check while still passing what it should leave alone.

| Control | Removes | Fails at | Still passes |
|---|---|---|---|
| `control-eager-node-global` | Restores the bug: one `Buffer.from` at load in `hostReviewWire.ts`. `npm run build` still passes | `app-loaded`: a blank window, with `ReferenceError: Buffer is not defined` | Served policy, no Node global on the page |
| `control-no-policy` | The whole policy | `served-policy`, and every probe: the inline script and `eval` ran, and the fetch, image, object and form reached the listener. The sibling-project probe is skipped on purpose, because here it would really reach Supabase | App, fonts, sidecar |
| `control-loose-script-style` | Adds `unsafe-eval` and `unsafe-inline` | `eval-blocked`, `inline-style-blocked`, `style-attribute-blocked` | `inline-script-blocked`, see the first note |
| `control-no-ipc` | `ipc:` and `http://ipc.localhost` | `no-violation`, `ipc-native` | Sidecar, through Tauri's silent `postMessage` fallback |
| `control-no-fonts` | `font-src` | `bundled-fonts` | App, sidecar |
| `control-no-script` | `script-src`, with Tauri's asset modification off for that directive | `app-loaded`: a blank window with no sidecar, no fonts and nothing rendered | Served policy |
| `control-no-supabase` | Both Supabase sources | `supabase-reached`. The real client tried the exact URL and the policy refused it; zero requests left | App, fonts |
| `control-wide-capability` | The narrowed capability | `capability-narrow` | App, sidecar |

Notes from those runs:

- **`npm run build` passing does not prove the app is not blank.** `control-eager-node-global` builds fine and renders nothing.
  Only the webview run, `coreBrowserLoad.test.ts` and rule CSP-22 catch that. This is how the defect stayed hidden.
- **`'unsafe-inline'` in `script-src` is inert here.** Tauri adds one `sha256` hash per bundled `.js` file to the served
  `script-src`, and a browser ignores `'unsafe-inline'` once a hash is present. That control was first written to fail at the
  inline script, and it did not, so it now names `eval-blocked`. The observation did not change, only the expectation.
- **Tauri's script hashes admit only bytes the app already ships.** The served `script-src` is the committed one plus those
  hashes, and the comparison allows them there and nowhere else. Tauri also puts `'self'` back beside them, so
  `script-src 'none'` alone cannot blank the app. That is why `control-no-script` has to switch the modification off.
- **`ipc:` failure is silent in the app.** Without those sources the app still works through `postMessage`, so only
  `no-violation` and `ipc-native` can see it.

## The Supabase request

**The live sign-in was not repeated on the production build.** The phase was allowed one request to Supabase, and it was spent on
the earlier build, which used the proof-only Vite config since removed. The rerun instruction did not lift that limit, so nothing
was sent this time. A rerun takes about eight minutes and is the lead's decision.

What stands from that one request, kept in the evidence as `earlierLiveSignIn` with that label: an invented address
(`csp-proof-no-such-user@example.com`) and a random password, through the real form. Sign-ups are off, and a password grant creates
nothing. `POST https://vzbzkziksxvyfqrdrwqx.supabase.co/auth/v1/token?grant_type=password` returned `400`, and the app showed
"Invalid login credentials". **The wire showed two HTTP exchanges for that one sign-in:** the POST, and the browser's automatic CORS
preflight to the same URL. No other request went to the host.

On the production build, `control-no-supabase` shows the real client aiming at that exact URL, and `strict-login-no-request` shows
the policy that allows it, served intact. The two builds differ in `hostReviewWire` and a bundler alias, neither of which touches
`connect-src`. That is an inference about the production build, not a run on it.

`.env.local` was read by the build script only, with no value printed or stored. The anon key is in the bundle, as it always is, and
every proof build was deleted afterwards.

**A successful sign-in remains an owner check.** This proves the app can reach the exact host under the policy and read the reply. It
does not prove a session, or the shell behind one. Owner's check, about a minute, after the next MSI: sign in once and see the shell.

## What this does not prove

- The `wss://` source is allowed by the policy and was not exercised. No screen uses realtime, and a socket would have been another
  request.
- `frame-ancestors` was not exercised: the app is a top-level window and nothing frames it. The header is served.
- Project screens were not rendered: the proof ran with no governed project, so the shell walk covers the rail's five destinations in
  their empty state. Rules CSP-10 to CSP-12 and the `cspPolicy.test.ts` scans cover the rest of the source statically.
- A release build, or the MSI. The proof binary is the debug profile, with the debug port and without the MSI resources.
  `generate_context!` embeds the same policy either way, but `release:payload` and the MSI itself have not been run.
- The WDIO desktop E2E under the new policy. Its plugin runs top-level scripts through `ExecuteScript`, which a page's CSP does not
  govern, and uses `eval` only inside frames, which the app does not have. So it should still work, but it was not run.

## The two cleanup refusals

**Cause, measured:** the harness was counting processes that had already been killed. `Stop-Process` succeeds at once, but the WebView2
process stays listed in `Win32_Process`, with `HasExited` true and one terminating thread, while Windows runs down its handles. One
sample went from 1,096 handles to 0 across three polls. Five cycles on a quiet machine took 16 to 90 seconds to clear. Four under
load took 6 to 23, though a sampler was also stopping processes during those, so they are not a clean comparison. The limits of 20
and 60 seconds were simply too short, so two healthy runs were refused. Nothing was leaked: all nine cycles cleared. Load did not make
it slower, and what sets the time was not established.

The limit is now 180 seconds. The check stays strict, because the profile folder cannot be removed until the handles close.

## Defects the proof found in itself

Each is fixed, and each is now a rule or a test.

- **A blank window counted as a control failing.** `control-no-supabase` reported proved while the window sat on `about:blank`. A
  control must now also pass what it should leave alone (`mustStillPass`).
- **The reload could cancel the app's own first navigation,** leaving `about:blank`. It now waits for the first load.
- **The reload aborts in-flight IPC,** which logs Tauri's fallback line. A timing rule misjudged this on the real build, so the line now
  counts unless its execution context is not the document under test. Real runs confirm it: two controls logged the line from the
  discarded document while the new one carried on over the custom protocol, and `ipc-native` checks that positively.
- **A WebView2 browser outlives `taskkill /T`.** The harness also stops whatever names its own profile, and checks that nothing remains,
  by profile and never by name.
- **The font record overstated:** a CSP-blocked file appears in Resource Timing with status 0. Only status 200 counts now.
- **The bundle scan first matched too much:** the word "process" in a WebAuthn error message read as a use. Only member access counts.

## Validators and tests

- `val-projectos-tenant-csp1a`, registered in `validate-all` and `cached-runner`: 23 rules plus CSP-T, with named mutations, each killed
  by its own rule. **CSP-21 fails by name when the production build needs a shim:** an alias beyond the two, a plugin, transform or
  `define` in `vite.config.ts`, a stub that answers instead of throwing, a Vite or stub file beside the proof, or a harness that stops
  using `npm run build`. CSP-22 fails on any load-time Node global in any core module. CSP-23 requires the clean-checkout record, and
  CSP-16 and CSP-23 bind the evidence to the hashes of the policy, capability and build sources.
- `projectos/control-center/test/cspPolicy.test.ts`, `coreBrowserLoad.test.ts`, `projectos/core/test/host-wire-constants.test.ts`.
- `docs/finish/PROJECTOS-TENANT-CSP1A.webview-evidence.json`: 11 runs, all proved, with no console text, header or body.
- In the clean clone: control-center 932 tests in 68 files, core 1,195, the agent's host tests 105, and `tsc` clean. The cleanup flake
  in `offLoopGovernedCommand.test.ts` seen earlier did not recur.

Full `validate-all` was not run, by instruction: the lead runs it.

## Running it again, and disk

```
node test/csp-webview/build-variant.mjs <variant>
node test/csp-webview/run-proof.mjs <variant> --out <file> [--live-sign-in]
CSP_PROOF_DISPOSABLE=1 node test/csp-webview/record-build.mjs <out.json>
node test/csp-webview/collect-evidence.mjs <runs-dir> <evidence-file>
```

Run these from `projectos/control-center` in a fresh clone, after `npm ci` in `core`, `agent`, `bridge/daemon` and `control-center`,
building the first three, and `npm run build:sidecar`. Set `CSP_PROOF_ENV_FILE` for the `login` variants. Without `--live-sign-in`
nothing goes to Supabase. **A rerun with that flag is a new request and a new decision.** The two scripts that edit tracked source refuse
to run without `CSP_PROOF_DISPOSABLE=1`.

Disk stayed well under the 8 GB limit, and free space never fell below 23 GB. The clean clone, with its packages and a private `CARGO_HOME`,
was removed when finished, along with every target directory. Nothing later needs them. No msedgedriver or other tool was installed.

## Carried, not done

- `INSTALLED_HOST_RUN_ID` is not lazy, see above. LOW.
- `src-tauri/Cargo.lock` is stale: it lacks three path crates, and `cargo --locked` refuses it. A normal build rewrites 32 lines. Those were
  not committed, as the file is outside the write paths. LOW.
- `tauri_plugin_opener` stays registered in `app.rs`, unused. LOW.
- `devCsp` is not enforced under `tauri dev`, see above. LOW.
- The live sign-in on the production build: the lead's decision.
- ECC SECURITY review, required by the plan and not yet run.
