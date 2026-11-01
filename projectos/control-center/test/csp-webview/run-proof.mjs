#!/usr/bin/env node
/**
 * THE REAL-WEBVIEW PROOF OF THE CSP — PROJECTOS-TENANT-CSP1A.
 *
 *   node test/csp-webview/run-proof.mjs <variant> --out <file> [--live-sign-in]
 *
 * Runs the debug executable `build-variant.mjs` just produced, in a real WebView2 window, and watches it
 * over the Chrome DevTools Protocol. No msedgedriver, no tauri-driver and no WebDriver feature: the only
 * thing the proof build adds is a loopback debug port (DEBUG_PORT in variants.mjs).
 * WEBVIEW2_USER_DATA_FOLDER keeps its profile away from any installed app. That is per-process environment,
 * so nothing on the machine changes.
 *
 * The page is reloaded once attached, so a violation at boot is seen rather than missed. A
 * `securitypolicyviolation` listener goes in ahead of the document, and the browser's own log is read too.
 *
 * Supabase: at most one sign-in, with an invented address and password, and only with --live-sign-in. A
 * latch file stops a second one. The control build drives the same form under a policy that lacks the
 * host; the run aborts before submitting if that policy names Supabase at all. The evidence carries the
 * method, host, path and status, and no header or body.
 *
 * Only the processes this run started are stopped. It never sweeps by name.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CONTROL_CENTER, DEBUG_PORT, policySupabaseHost, variants } from './variants.mjs';
import { judge, outcome } from './verdict.mjs';

const TARGET_ROOT = process.env.CSP_PROOF_TARGET_ROOT ?? join(CONTROL_CENTER, 'src-tauri', 'target');
const EXE = join(TARGET_ROOT, 'csp1a', 'debug', 'projectos-control-center.exe');
const LATCH = join(TARGET_ROOT, 'csp1a-config', 'live-sign-in.latch');
const SIBLING_PROJECT = 'https://not-this-project.supabase.co/rest/v1/';
const INVENTED_ADDRESS = 'csp-proof-no-such-user@example.com';
const TEXT_LIMIT = 300;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(read, timeoutMs, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await sleep(stepMs);
  }
}

function portOpen(port) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
}

/**
 * The debug port is fixed, so a browser from another run would answer in this one's place. No run starts
 * until the port is closed, and none ends before it is.
 */
async function requirePortClosed(port) {
  const closed = await until(async () => !(await portOpen(port)), 30_000);
  if (closed === null) throw new Error(`port ${port} is still open: a webview from another run is alive`);
}

/** Counts what actually arrives. A probe that a policy stopped never reaches this. */
function startListener() {
  const hits = {};
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    hits[path] = (hits[path] ?? 0) + 1;
    response.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
    response.end('ok');
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done({ server, hits, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

class Cdp {
  #next = 0;
  #pending = new Map();
  #listeners = [];

  constructor(socket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const waiter = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (waiter === undefined) return;
        if (message.error) waiter.fail(new Error(`${waiter.method}: ${message.error.message}`));
        else waiter.done(message.result);
        return;
      }
      for (const listener of this.#listeners) listener(message.method, message.params);
    });
  }

  on(listener) {
    this.#listeners.push(listener);
  }

  send(method, params = {}) {
    this.#next += 1;
    const id = this.#next;
    return new Promise((done, fail) => {
      this.#pending.set(id, { done, fail, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** In the page, under the page's own policy: eval stays blocked rather than being waved through. */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      allowUnsafeEvalBlockedByCSP: false,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }
}

async function attach(port) {
  const target = await until(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await response.json();
      return list.find((entry) => entry.type === 'page' && /^https?:\/\/tauri\.localhost/.test(entry.url)) ?? null;
    } catch {
      return null;
    }
  }, 90_000, 500);
  if (target === null) throw new Error('the webview never offered a page target');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', () => fail(new Error('the debug socket did not open')), { once: true });
  });
  return new Cdp(socket);
}

const LISTENER = `
  window.__cspProof = { violations: [] };
  document.addEventListener('securitypolicyviolation', (event) => {
    window.__cspProof.violations.push({
      directive: event.effectiveDirective,
      blocked: String(event.blockedURI).slice(0, 200),
      disposition: event.disposition,
    });
  });
`;

const readViolations = (cdp) => cdp.evaluate(`JSON.stringify(window.__cspProof ? window.__cspProof.violations : [])`).then(JSON.parse);

async function observeFonts(cdp) {
  const raw = await cdp.evaluate(`(async () => {
    await document.fonts.ready;
    await Promise.allSettled([document.fonts.load('400 16px Barlow'), document.fonts.load('600 16px "Barlow Condensed"')]);
    const faces = [...document.fonts].map((f) => ({ family: f.family, weight: f.weight, status: f.status }));
    const requested = performance.getEntriesByType('resource')
      .filter((e) => e.name.endsWith('.woff2') && e.responseStatus === 200)
      .map((e) => ({ name: new URL(e.name).pathname, ok: true }));
    const canvas = document.createElement('canvas').getContext('2d');
    const measure = (font) => { canvas.font = font; return canvas.measureText('Hamburgefonstiv 0123456789').width; };
    const body = getComputedStyle(document.body).fontFamily;
    return JSON.stringify({ faces, requested, body, barlow: measure('400 32px Barlow'), fallback: measure('400 32px Georgia') });
  })()`);
  const seen = JSON.parse(raw);
  const barlowLoaded = seen.faces.some((f) => f.family.replace(/"/g, '') === 'Barlow' && f.status === 'loaded');
  return {
    ...seen,
    bundledLoaded: barlowLoaded && seen.requested.some((r) => r.name.startsWith('/fonts/Barlow-') && r.ok),
    widthDiffers: seen.barlow > 0 && seen.barlow !== seen.fallback,
  };
}

/** The real IPC, then a real round trip to the sidecar, using the two permissions the window still has. */
async function observeSidecar(cdp) {
  const raw = await cdp.evaluate(`(async () => {
    const tauri = window.__TAURI_INTERNALS__;
    if (!tauri) return JSON.stringify({ state: 'no tauri internals', messages: 0 });
    let status = await tauri.invoke('daemon_status');
    for (let i = 0; i < 120 && status.state !== 'RUNNING_READ_ONLY'; i += 1) {
      await new Promise((done) => setTimeout(done, 500));
      status = await tauri.invoke('daemon_status');
    }
    let messages = 0;
    const kinds = {};
    const handler = tauri.transformCallback((event) => {
      messages += 1;
      let kind = 'unparsed';
      try { kind = String(JSON.parse(event.payload).type ?? 'untyped'); } catch {}
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    });
    const eventId = await tauri.invoke('plugin:event|listen', { event: 'daemon://message', target: { kind: 'Any' }, handler });
    if (status.state === 'RUNNING_READ_ONLY') await tauri.invoke('daemon_request_snapshot');
    for (let i = 0; i < 40 && messages === 0; i += 1) await new Promise((done) => setTimeout(done, 250));
    await tauri.invoke('plugin:event|unlisten', { event: 'daemon://message', eventId });
    return JSON.stringify({ state: status.state, readOnly: status.readOnlyAvailable, messages, kinds });
  })()`);
  return JSON.parse(raw);
}

/** Every screen the rail offers, so each one renders under the policy. */
async function walkScreens(cdp) {
  const labels = ['Projects', 'Execution', 'Control Center', 'Health', 'Settings'];
  const walked = [];
  for (const label of labels) {
    const clicked = await cdp.evaluate(`(() => {
      const rail = document.querySelector('.os-rail');
      const button = rail && [...rail.querySelectorAll('button')].find((b) => {
        const name = b.querySelector('.ux-navlabel');
        return (name ? name.firstChild.textContent : b.textContent).trim() === ${JSON.stringify(label)};
      });
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (clicked) {
      await sleep(700);
      walked.push(label);
    }
  }
  return walked;
}

/** Permissions the old capability granted. Harmless reads: each only answers whether the call is allowed. */
async function observeCapability(cdp) {
  const denied = (command, args) => cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})
    .then(() => false, (error) => /not allowed|denied/i.test(String(error)))`);
  const windowDenied = await denied('plugin:window|is_visible', { label: 'main' });
  // Only once the window call is denied: under the old capability this one would open a URL.
  const openerDenied = windowDenied === true ? await denied('plugin:opener|open_url', { url: 'https://example.com/' }) : false;
  return { windowDenied, openerDenied };
}

/**
 * The deliberate violations. Each returns `effect: true` if the thing it attempted actually happened.
 * The form goes last: without a policy it leaves the app, which is the point of the control.
 */
async function runProbes(cdp, listener, policy, network) {
  const probes = {};
  const attempt = async (name, source) => {
    probes[name] = { attempted: true, effect: await cdp.evaluate(source) === true };
    await sleep(200);
  };
  await attempt('inlineScript', `(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__cspInlineRan = true';
    document.head.append(s);
    s.remove();
    return window.__cspInlineRan === true;
  })()`);
  await attempt('evalCall', `(() => { try { return eval('21 * 2') === 42; } catch { return false; } })()`);
  await attempt('foreignFetch', `fetch(${JSON.stringify(`${listener.base}/fetch`)}, { mode: 'no-cors' }).then(() => true, () => false)`);
  await sleep(200);
  probes.foreignFetch.hits = listener.hits['/fetch'] ?? 0;

  // Only after the plain foreign fetch was stopped, and never under a policy that would let it out.
  const mayProbeSibling = probes.foreignFetch.hits === 0 && typeof policy === 'string' && !policy.includes('*');
  if (mayProbeSibling) {
    await attempt('siblingProject', `fetch(${JSON.stringify(SIBLING_PROJECT)}, { mode: 'no-cors' }).then(() => true, () => false)`);
    const named = (await readViolations(cdp)).some((v) => v.directive === 'connect-src' && v.blocked.startsWith(SIBLING_PROJECT));
    const onTheWire = network.requests.some((r) => r.host === new URL(SIBLING_PROJECT).host && r.status !== undefined);
    probes.siblingProject.blockedByPolicy = named && !onTheWire;
  }

  await attempt('foreignImage', `new Promise((done) => {
    const image = new Image();
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.src = ${JSON.stringify(`${listener.base}/image`)};
  })`);
  await sleep(200);
  probes.foreignImage.hits = listener.hits['/image'] ?? 0;

  await attempt('inlineStyle', `(() => {
    const target = document.body.appendChild(document.createElement('div'));
    target.id = 'csp-proof-style';
    const style = document.createElement('style');
    style.textContent = '#csp-proof-style { color: rgb(1, 2, 3); }';
    document.head.append(style);
    const applied = getComputedStyle(target).color === 'rgb(1, 2, 3)';
    style.remove();
    target.remove();
    return applied;
  })()`);
  await attempt('styleAttribute', `(() => {
    const target = document.body.appendChild(document.createElement('div'));
    target.setAttribute('style', 'color: rgb(4, 5, 6)');
    const applied = getComputedStyle(target).color === 'rgb(4, 5, 6)';
    target.remove();
    return applied;
  })()`);
  await attempt('cssomStyle', `(() => {
    const target = document.body.appendChild(document.createElement('div'));
    target.style.color = 'rgb(7, 8, 9)';
    const applied = getComputedStyle(target).color === 'rgb(7, 8, 9)';
    target.remove();
    return applied;
  })()`);
  await attempt('baseUri', `(() => {
    const before = document.baseURI;
    const base = document.createElement('base');
    base.href = ${JSON.stringify(`${listener.base}/`)};
    document.head.append(base);
    const changed = document.baseURI !== before;
    base.remove();
    return changed;
  })()`);
  await attempt('objectEmbed', `new Promise((done) => {
    const object = document.createElement('object');
    object.data = ${JSON.stringify(`${listener.base}/object`)};
    object.onload = () => done(true);
    object.onerror = () => done(false);
    document.body.append(object);
    setTimeout(() => done(false), 1500);
  })`);
  await sleep(300);
  probes.objectEmbed.hits = listener.hits['/object'] ?? 0;
  probes.objectEmbed.effect = probes.objectEmbed.hits > 0;

  const violationsBeforeForm = await readViolations(cdp);
  await cdp.evaluate(`(() => {
    const form = document.createElement('form');
    form.action = ${JSON.stringify(`${listener.base}/form`)};
    form.method = 'get';
    document.body.append(form);
    form.submit();
  })()`).catch(() => {});
  await sleep(1200);
  const formHits = listener.hits['/form'] ?? 0;
  probes.formAction = { attempted: true, effect: formHits > 0, hits: formHits };
  const after = await readViolations(cdp).catch(() => violationsBeforeForm);
  return { probes, probeViolations: after };
}

/** Types into the real form and clicks the real button. Returns once the app has reacted. */
async function submitLogin(cdp, password) {
  const fill = async (selector, text) => {
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await cdp.send('Input.insertText', { text });
  };
  await fill('input[type=email]', INVENTED_ADDRESS);
  await fill('input[type=password]', password);
  await cdp.evaluate(`document.querySelector('form button[type=submit]').click()`);
  return until(() => cdp.evaluate(`(() => {
    const alert = document.querySelector('[role=alert]');
    return alert ? alert.textContent : null;
  })()`), 20_000);
}

function summariseSupabase(network, host) {
  const onHost = network.requests.filter((r) => r.host === host);
  const real = onHost.filter((r) => r.type !== 'Preflight' && r.method === 'POST');
  const preflights = onHost.filter((r) => r.type === 'Preflight' || r.method === 'OPTIONS');
  const first = real[0];
  return {
    policyHost: host,
    host: first?.host ?? null,
    method: first?.method ?? null,
    path: first?.path ?? null,
    query: first?.query ?? null,
    status: first?.status ?? null,
    requests: real.filter((r) => r.blockedReason === undefined).length,
    blockedByPolicy: real.filter((r) => r.blockedReason !== undefined).length,
    preflights: preflights.length,
    otherOnHost: onHost.length - real.length - preflights.length,
  };
}

async function drive(cdp, variant, listener, live) {
  const obs = { servedPolicy: null, violations: [], consoleViolations: [], console: [], abortedByReload: 0 };
  const network = { requests: [] };
  const byId = new Map();
  let reloaded = false;

  const keepConsole = (text) => {
    const line = String(text).slice(0, TEXT_LIMIT);
    obs.console.push(line);
    // This run's own reload aborts whatever IPC call was in flight on the old document, and Tauri reports
    // that with this line. Only a line from before the new document commits is excused, and it stays on the
    // record. 'ipc-native' is the positive check that the new document's IPC really used the custom protocol.
    if (!reloaded && /IPC custom protocol failed/.test(line)) {
      obs.abortedByReload += 1;
      return;
    }
    if (/Content Security Policy|Refused to|IPC custom protocol failed/i.test(line)) obs.consoleViolations.push(line);
  };
  cdp.on((method, params) => {
    if (method === 'Page.frameNavigated' && params.frame.parentId === undefined) reloaded = true;
    if (method === 'Log.entryAdded') keepConsole(params.entry.text);
    if (method === 'Runtime.exceptionThrown') keepConsole(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'warning')) {
      keepConsole(params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
    if (method === 'Network.requestWillBeSent') {
      const url = new URL(params.request.url);
      const entry = { method: params.request.method, host: url.host, path: url.pathname, query: url.search, type: params.type, afterReload: reloaded };
      byId.set(params.requestId, entry);
      network.requests.push(entry);
    }
    if (method === 'Network.responseReceived') {
      const entry = byId.get(params.requestId);
      if (entry !== undefined) entry.status = params.response.status;
      if (params.type === 'Document') {
        const headers = params.response.headers ?? {};
        const key = Object.keys(headers).find((name) => name.toLowerCase() === 'content-security-policy');
        obs.servedPolicy = key === undefined ? null : headers[key];
      }
    }
    if (method === 'Network.loadingFailed' && params.blockedReason) {
      const entry = byId.get(params.requestId);
      if (entry !== undefined) entry.blockedReason = params.blockedReason;
    }
  });

  obs.browser = (await cdp.send('Browser.getVersion')).product;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: LISTENER });
  // Not before the first load has finished. WebView2 starts on about:blank, and a reload at that moment
  // cancels the app's own navigation and leaves a blank window.
  const firstLoad = await until(() => cdp.evaluate(`location.href.startsWith('http://tauri.localhost') && document.readyState === 'complete'`).catch(() => false), 60_000);
  if (firstLoad === null) throw new Error('the app never finished its first load');
  await cdp.send('Page.reload', { ignoreCache: true });

  const selector = variant.profile === 'login' ? 'form.login-card input[type=password]' : '.os-rail nav[aria-label=Primary]';
  let lastEvaluateError = null;
  const rendered = await until(() => cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}) !== null`).catch((error) => {
    lastEvaluateError = String(error.message).slice(0, TEXT_LIMIT);
    return false;
  }), 45_000);
  await sleep(1500);
  obs.nodeGlobals = JSON.parse(await cdp.evaluate(`JSON.stringify({
    Buffer: typeof Buffer, process: typeof process, global: typeof global, require: typeof require, setImmediate: typeof setImmediate,
  })`).catch(() => 'null'));
  obs.loaded = {
    rendered: rendered === true,
    elements: await cdp.evaluate(`document.querySelectorAll('#root *').length`).catch(() => 0),
    title: await cdp.evaluate('document.title').catch(() => ''),
    url: await cdp.evaluate('location.href').catch(() => ''),
    lastEvaluateError,
  };

  if (obs.loaded.rendered) {
    if (variant.profile === 'shell') {
      obs.sidecar = await observeSidecar(cdp).catch((error) => ({ state: `error: ${error.message}`, messages: 0 }));
      obs.walked = await walkScreens(cdp);
      await sleep(1000);
    }
    obs.fonts = await observeFonts(cdp).catch((error) => ({ error: String(error.message).slice(0, TEXT_LIMIT) }));
    obs.violations = await readViolations(cdp);
    obs.normalUseRan = true;
  }
  const consoleBeforeProbes = obs.consoleViolations.length;

  if (obs.loaded.rendered && variant.profile === 'shell') {
    obs.capability = await observeCapability(cdp);
    Object.assign(obs, await runProbes(cdp, listener, obs.servedPolicy, network));
  }

  if (obs.loaded.rendered && variant.profile === 'login') {
    const host = policySupabaseHost();
    const mayLeave = variant.signIn === true && live;
    const blockedControl = variant.blockedSignIn === true;
    if (blockedControl && String(obs.servedPolicy).includes('supabase.co')) {
      throw new Error('the no-Supabase control is serving a policy that names Supabase; nothing was submitted');
    }
    if (mayLeave || blockedControl) {
      if (mayLeave) {
        if (existsSync(LATCH)) throw new Error('the one live sign-in has already been used');
        mkdirSync(dirname(LATCH), { recursive: true });
        writeFileSync(LATCH, `${new Date().toISOString()}\n`);
      }
      const shownError = await submitLogin(cdp, randomBytes(18).toString('base64url'));
      await sleep(1000);
      obs.signIn = { attempted: true, shownError: shownError === null ? null : String(shownError).slice(0, 120), ...summariseSupabase(network, host) };
      obs.violations = await readViolations(cdp);
    } else {
      obs.signIn = { attempted: false, ...summariseSupabase(network, host) };
    }
  }
  if (variant.profile === 'shell') obs.consoleViolations = obs.consoleViolations.slice(0, consoleBeforeProbes);
  obs.ipcNative = network.requests.filter((r) => r.host === 'ipc.localhost' && r.afterReload && r.status === 200).length;
  obs.listenerHits = { ...listener.hits };
  return obs;
}

function stopTree(pid) {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

/**
 * Stops whatever still names this run's own profile, and returns what it found. Nothing else on the
 * machine can match it. Stop-Process, not taskkill: the WebView2 browser outlives its host, and taskkill
 * could not end it.
 */
function stopProfileHolders(profile) {
  const script = [
    '$held = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:CSP_PROOF_PROFILE) -and $_.ProcessId -ne $PID })',
    '$held | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue }',
    '$held | ForEach-Object { Write-Output ($_.Name + "#" + $_.ProcessId) }',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, CSP_PROOF_PROFILE: profile },
  });
  if (result.status !== 0) return [`the process query failed: ${String(result.stderr).slice(0, TEXT_LIMIT)}`];
  return result.stdout.split(/\s+/).filter(Boolean);
}

/** Checked, never assumed. A pass means the last look found nothing. */
async function stopProfile(profile) {
  let held = [];
  const gone = await until(() => {
    held = stopProfileHolders(profile);
    return held.length === 0;
  }, 60_000, 1000);
  if (gone === null) throw new Error(`still holding ${profile}: ${held.join(' ')}`);
}

export async function runVariant(name, { live }) {
  const variant = variants()[name];
  if (variant === undefined) throw new Error(`unknown variant: ${name}`);
  if (!existsSync(EXE)) throw new Error(`no debug executable; run build-variant.mjs ${name} first`);
  const profile = join(TARGET_ROOT, 'csp1a-config', `webview-${name}`);
  await stopProfile(profile);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
  mkdirSync(profile, { recursive: true });
  await requirePortClosed(DEBUG_PORT);
  const listener = await startListener();

  const app = spawn(EXE, [], {
    cwd: dirname(EXE),
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: profile,
    },
    stdio: 'ignore',
  });
  let cdp = null;
  try {
    cdp = await attach(DEBUG_PORT);
    const obs = await drive(cdp, variant, listener, live);
    const verdict = judge(obs, variant);
    return { variant: name, expect: variant.expect, mustFailAt: variant.mustFailAt ?? null, proved: outcome(variant, verdict), verdict, obs };
  } finally {
    try {
      cdp?.socket.close();
    } catch {
      // the window may already be gone
    }
    stopTree(app.pid);
    listener.server.close();
    listener.server.closeAllConnections();
    await stopProfile(profile);
    await requirePortClosed(DEBUG_PORT);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]).endsWith('run-proof.mjs')) {
  const [name, ...rest] = process.argv.slice(2);
  const outAt = rest.indexOf('--out');
  const out = outAt >= 0 ? rest[outAt + 1] : null;
  if (!name || !out) {
    console.error('usage: run-proof.mjs <variant> --out <file> [--live-sign-in]');
    process.exit(2);
  }
  runVariant(name, { live: rest.includes('--live-sign-in') }).then(
    (result) => {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
      for (const check of result.verdict.checks) console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.id} ${check.detail}`);
      console.log(`[csp-proof] ${name}: ${result.proved ? 'PROVED' : 'NOT PROVED'} (expected ${result.expect}${result.mustFailAt ? ` at ${result.mustFailAt}` : ''})`);
      process.exit(result.proved ? 0 : 1);
    },
    (error) => {
      console.error(`[csp-proof] ${name}: ${error.message}`);
      process.exit(1);
    },
  );
}
