# PROJECTOS-TENANT-CSP1A — evidence

**Phase:** PROJECTOS-TENANT-CSP1A, phase 5 of V4 Stage 2, plan v1.33. Owner decision D6: "Approve strict policy
(Recommended)".
**Branch:** `projectos-tenant-csp1a`, rebased on `projectos-autonomy-bootstrap1a` at `374f9eaf`.
**Route:** built by a Claude subagent in its own worktree, under the lead. This document claims no gatekeeper ruling
and no closure. ECC SECURITY reviewed `509bda25`: APPROVE WITH CHANGES, no CRITICAL. The changes below answer it. They
have not themselves been reviewed.
**Boundary:** debug builds only. No MSI, no release build, no install, no service, no ACL or registry change, no
deployment, no push. One request went to Supabase, on the earlier build, described below.

**The installed app gets this policy only when the MSI is next rebuilt.** The rebuild is no longer blocked by the
frontend build. It has not been attempted: `npm run build` passes, and the packaging steps after it
(`release:payload`, `release:register-helper`, the bundle) were not run.

## ECC SECURITY review

| Finding | Severity | Disposition |
|---|---|---|
| A stale `core/dist` reproduces the blank window with a passing build | MEDIUM | Fixed. `npm run build` rebuilds core first and scans the chunks it built. See "A stale dist" below |
| CSP-22 misses `{ magic: Buffer.from() }` and immediately invoked functions | LOW | Fixed. Only a function body is deferred now, with four new mutations. `coreBrowserLoad.test.ts` is the proof, and CSP-22 is the fast check in front of it. CSP-22 reads text, so it cannot see inside a top-level `if`, for one. The test runs the modules, so it can |
| CSP-11 and CSP-12 miss `<img src=https`, `new Worker` and `.innerHTML +=` | LOW | Fixed. Both rules now cover them, plus workers of any kind, remote markup, `index.html` and `styles.css` |
| The evidence can go stale silently | LOW | Fixed where cheap. See "What the evidence is bound to" below |
| The capability description says commands are "authorised by their own Rust handlers" | LOW | Fixed. It said something untrue. It now says they have no caller check and the CSP is the barrier. CSP-9 pins that |
| No command manifest; `ipc:`; the latch under `target/` | LOW | Carried, see the end. The commands are listed in full below and in the evidence |

Each fix was written test first. The tests were run and seen to fail, including the reviewer's three misses surviving as named
mutants, before the code changed.

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

### A stale dist

The renderer bundles core from `dist`, not source, and `npm run build` never built it. `release:prepare` runs `npm run build`,
so a release could ship whatever `core/dist` happened to hold. The main checkout's old `dist` still had the load-time `Buffer`, so
clean source gave a passing build and a blank window.

**A stale `core/dist` can no longer reach the bundle through `npm run build`.** `build` is now three steps: `npm --prefix ../core run
build`, then `npm run build:renderer`, then `node test/csp-webview/scan-bundle.cjs`. The scan reads the built chunks and fails, naming
what it found, on any Node global with no `typeof` guard beside it, whatever the source says. Rule CSP-24 runs the same scan over any
bundle on disk, so a stale `dist` fails the validator as well. It is stricter than load time, because a bare use inside a function fails
too. It cannot see a global reached indirectly, such as `globalThis['Buf' + 'fer']`; the webview run covers that.

`build:renderer` alone skips both safeguards. Only the control that restores the bug uses it.

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
| `core/dist` made stale with a load-time `Buffer`, then `npm run build` | Passes, and the bundle is clean: the rebuild replaced it |
| The same stale `dist`, with the renderer built alone, then the scan | The renderer build passes, and the scan refuses it, naming `Buffer.from` |
| A load-time `Buffer` in the source, then `npm run build` | Fails, naming `Buffer.from` |
| `validate-desktop-e2e` on the real bundle | Passes |

### Running `validate-desktop-e2e`

**`validate-desktop-e2e` cannot pass in a fresh worktree until a bundle is built.** Check 5 reads `dist/assets`, `dist` is gitignored,
and the check fails closed by design. This phase did not change that check.

**Once this lands it is no longer a meaningful known baseline.** It failed for a real reason from 2026-09-25, because no bundle could be
built, and anything treating that failure as expected would now hide a real one. A failure at check 5 means nobody ran the build. Any other
failure is real. Retire the label rather than carry it forward.

**How to run it:** `npm ci` in `projectos/core` and `projectos/control-center`, then `npm run build` in `projectos/control-center`, then `node projectos/validators/validate-desktop-e2e.cjs`
from the repository root, or `validate-all`. Use a real checkout: in a worktree whose `node_modules` is a link to another worktree, the
bundle comes from that worktree's `core`, which is what hid this. The scan still judges that bundle, but it is not this checkout's code.

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

**This list does not gate app commands.** The app defines no command manifest, so the window may call every command in
`generate_handler!`, and none of them checks its caller. Script running in the window can reach all of them, so the CSP is the barrier
that keeps injected script out. That is the job the policy is doing:

| Command | Effect | Owner step |
|---|---|---|
| `daemon_status`, `identity_status`, `installed_host_status`, `daemon_request_snapshot`, `list_project_files` | Read | None |
| `pick_folder`, `pick_file` | Read | Native dialog |
| `inspect_folder` | Reads a named folder | None |
| `daemon_governed_command` | Forwards a verb to the sidecar, which validates it | None |
| `prepare_folder` | Adds files to a named folder | None |
| `import_project_file` | Copies a file into a registered project | None |
| `register_project` | Writes the protected registry through an elevated helper | UAC prompt |
| `set_credential` | Writes a credential | None |

Rule CSP-25 holds this list equal to `generate_handler!`, so a new command fails until someone says what it does.
`tauri_plugin_opener::init()` stays in `app.rs` and `Cargo.toml`, unused and now unreachable from the window. Removing it is a LOW,
outside this phase's write paths.

## What the evidence is bound to

The webview evidence holds hashes of the policy, the `devCsp`, the capability's permissions, the build sources and the frontend surface.
Change one and CSP-16 or CSP-23 fails, naming it, until the proof is rerun.

The surface covers what the proof depends on: which Tauri modules the frontend imports, which commands exist, the build scripts and the page
shell. **It does not cover every frontend file, on purpose.** That would turn each UI commit red until a webview rerun, and a check that is
always red gets ignored. Rules CSP-10 to CSP-12 judge the rest of the source on every run. So an ordinary UI change does not rerun the proof.
If the owner wants that, it is one line, and the cost is a rerun of about 15 minutes per change.

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
| `control-eager-node-global` | Restores the bug: one `Buffer.from` at load in `hostReviewWire.ts`, built with `build:renderer`, because `npm run build` now refuses it | `app-loaded`: a blank window, with `ReferenceError: Buffer is not defined` | Served policy, no Node global on the page |
| `control-no-policy` | The whole policy | `served-policy`, and every probe: the inline script and `eval` ran, and the fetch, image, object and form reached the listener. The sibling-project probe is skipped on purpose, because here it would really reach Supabase | App, fonts, sidecar |
| `control-loose-script-style` | Adds `unsafe-eval` and `unsafe-inline` | `eval-blocked`, `inline-style-blocked`, `style-attribute-blocked` | `inline-script-blocked`, see the first note |
| `control-no-ipc` | `ipc:` and `http://ipc.localhost` | `no-violation`, `ipc-native` | Sidecar, through Tauri's silent `postMessage` fallback |
| `control-no-fonts` | `font-src` | `bundled-fonts` | App, sidecar |
| `control-no-script` | `script-src`, with Tauri's asset modification off for that directive | `app-loaded`: a blank window with no sidecar, no fonts and nothing rendered | Served policy |
| `control-no-supabase` | Both Supabase sources | `supabase-reached`. The real client tried the exact URL and the policy refused it; zero requests left | App, fonts |
| `control-wide-capability` | The narrowed capability | `capability-narrow` | App, sidecar |

Notes from those runs:

- **A renderer build passing does not prove the app is not blank.** `control-eager-node-global` builds fine with `build:renderer`
  and renders nothing. That is how the defect stayed hidden, and why `npm run build` now ends with the scan.
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

## One unexplained sidecar crash

One `strict-shell` run, on the first clean clone after the rebase, ended with the sidecar `CRASHED`. The policy side of that run was clean:
every probe was blocked, with no violation. The harness did not then record the status's `failure` field, so **the cause is unknown**. Run by
itself the sidecar started and stayed up, a first launch from a second fresh clone reached it, and so did every shell run in the evidence. The
field is recorded now, so a repeat will name itself. It is not known to be a CSP matter, and it is not known not to recur.

## Defects the proof found in itself

Each is fixed, and each is now a rule or a test.

- **A blank window counted as a control failing.** `control-no-supabase` reported proved while the window sat on `about:blank`. A
  control must now also pass what it should leave alone (`mustStillPass`).
- **The reload could cancel the app's own first navigation,** leaving `about:blank`. It now waits for the first load.
- **The reload aborts in-flight IPC,** which logs Tauri's fallback line. A timing rule misjudged this on the real build, so the line now
  counts unless its execution context is not the document under test. An earlier run confirmed it on real data: two controls logged
  the line from the discarded document while the new one carried on over the custom protocol. No passing run in this evidence has
  the line at all, and `ipc-native` checks the new document positively.
- **A WebView2 browser outlives `taskkill /T`.** The harness also stops whatever names its own profile, and checks that nothing remains,
  by profile and never by name.
- **The font record overstated:** a CSP-blocked file appears in Resource Timing with status 0. Only status 200 counts now.
- **The bundle scan first matched too much:** the word "process" in a WebAuthn error message read as a use. Only member access counts.

## Validators and tests

- `val-projectos-tenant-csp1a`, registered in `validate-all` and `cached-runner`: 25 rules plus CSP-T, with named mutations, each killed
  by its own rule. **CSP-21 fails by name when the production build needs a shim:** an alias beyond the two, a plugin, transform or
  `define` in `vite.config.ts`, a stub that answers instead of throwing, a Vite or stub file beside the proof, or a harness that stops
  using `npm run build`. CSP-22 fails on any load-time Node global in any core module. CSP-23 requires the clean-checkout record, and
  CSP-16 and CSP-23 bind the evidence to the hashes of the policy, capability and build sources.
- `projectos/control-center/test/cspPolicy.test.ts`, `coreBrowserLoad.test.ts`, `projectos/core/test/host-wire-constants.test.ts`.
- `docs/finish/PROJECTOS-TENANT-CSP1A.webview-evidence.json`: 11 runs, all proved, with no console text, header or body.
- In the clean clone: control-center 952 tests in 69 files, core 1865, and `tsc` clean. The agent's host tests, 105, last ran before the rebase. The cleanup flake
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
- Carried: a real command manifest. `tauri_build::AppManifest` in `build.rs` would let the capability gate app commands, so `set_credential`
  stops being reachable by default. `build.rs` is outside the write paths. It is the proper fix for the barrier being a single layer. LOW.
- `ipc:` in `connect-src`. Windows uses `http://ipc.localhost`, so `ipc:` serves platforms this app does not ship on. It stays because
  the owner approved the policy as written. Dropping it is a one-word change and a rerun. LOW.
- The sign-in latch sits under `target/`, so removing the target directory forgets it. The one-request limit holds by instruction, not by
  that file, after a clean. Keeping it outside `target/` is a small change. LOW.
- `src-tauri/Cargo.lock` is stale: it lacks three path crates, and `cargo --locked` refuses it. A normal build rewrites 32 lines. Those were
  not committed, as the file is outside the write paths. LOW.
- `tauri_plugin_opener` stays registered in `app.rs`, unused. LOW.
- `devCsp` is not enforced under `tauri dev`, see above. LOW.
- The live sign-in on the production build: the lead's decision.
- A recheck of the changes above, if the lead wants one.
