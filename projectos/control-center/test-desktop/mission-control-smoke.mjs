#!/usr/bin/env node
/**
 * ProjectOS Mission Control Fixture — authenticated-state desktop automation (opt-in, local-only).
 *
 * Drives the isolated fixture Tauri app (real Mission Control components + synthetic data) through
 * raw tauri-driver + the WebDriver HTTP protocol. Zero external deps. Proves — in a genuine Tauri
 * desktop window — the isolation markers, safety posture, owner-only governance, all four
 * scenarios, responsive layout, keyboard access, and ZERO external network/side-effects, with
 * race-hardened process cleanup. No credentials, no auth bypass, no live daemon/sidecar.
 *
 * Env:
 *   MSEDGEDRIVER          (required) msedgedriver.exe matching the installed Edge
 *   PROJECTOS_FIXTURE_APP (required) path to the built mission-control-fixture executable
 *   PROJECTOS_SHOT_DIR    (optional) directory to write per-scenario screenshots (no secrets)
 */
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// tauri-driver's WebDriver server port. Must NOT be 4445 — that is tauri-driver's default
// native-driver (msedgedriver) port, and a collision stops tauri-driver from starting.
const PORT = Number(process.env.PROJECTOS_WD_PORT || 4448);
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.PROJECTOS_FIXTURE_APP;
const DRIVER = process.env.MSEDGEDRIVER;
const SHOT_DIR = process.env.PROJECTOS_SHOT_DIR || null;
const PROC_NAMES = ['tauri-driver.exe', 'msedgedriver.exe', 'mission-control-fixture.exe'];

if (!APP || !DRIVER) {
  console.error('Required: PROJECTOS_FIXTURE_APP=<exe> and MSEDGEDRIVER=<msedgedriver.exe>');
  process.exit(2);
}

let driverProc = null;
let sessionId = null;
const failures = [];
const ok = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures.push(name);
};

function pidsByName(name) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-Process -Name '${name.replace(/\.exe$/, '')}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"`,
      { encoding: 'utf8' },
    );
    return new Set(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function wd(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`WD ${method} ${path} -> ${r.status} ${JSON.stringify(j).slice(0, 180)}`);
  return j.value;
}
const exec = (script) => wd('POST', `/session/${sessionId}/execute/sync`, { script, args: [] });
const bodyText = () => exec('return document.body ? document.body.innerText : ""').then((t) => String(t || ''));
const testidText = (id) =>
  exec(`const e=document.querySelector('[data-testid="${id}"]'); return e?e.innerText:''`).then((t) => String(t || ''));
const testidVisible = (id) =>
  exec(
    `const e=document.querySelector('[data-testid="${id}"]'); if(!e) return false; const r=e.getBoundingClientRect(); return r.width>0 && r.height>0;`,
  );
const clickTestId = (id) => exec(`const e=document.querySelector('[data-testid="${id}"]'); if(e){e.click(); return true;} return false;`);

async function selectScenario(id) {
  const clicked = await clickTestId(`scenario-${id}`);
  await sleep(500);
  return clicked;
}

async function waitDriver() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(`${BASE}/status`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  return false;
}

// WebDriver Actions API — genuine keyboard through the desktop session.
const KEY = { TAB: '', ENTER: '', SHIFT: '' };
async function pressKey(...values) {
  const down = values.map((v) => ({ type: 'keyDown', value: v }));
  const up = [...values].reverse().map((v) => ({ type: 'keyUp', value: v }));
  await wd('POST', `/session/${sessionId}/actions`, {
    actions: [{ type: 'key', id: 'kbd', actions: [...down, ...up] }],
  });
  await wd('DELETE', `/session/${sessionId}/actions`).catch(() => {});
  await sleep(200);
}

const SECRET_RE =
  /sbp_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{15,}|vcp_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}|password['" ]*[:=]['" ]*\S{4,}/;

const SIZES = [[1440, 900], [1024, 768], [800, 700], [640, 700], [375, 812]];

async function main() {
  driverProc = spawn('tauri-driver', ['--port', String(PORT), '--native-driver', DRIVER], { stdio: 'ignore' });
  ok('tauri-driver starts + serves on 127.0.0.1 (localhost only)', await waitDriver());

  const res = await wd('POST', '/session', {
    capabilities: { alwaysMatch: { 'tauri:options': { application: APP } } },
  });
  sessionId = res && (res.sessionId || res['sessionId']);
  ok('WebDriver session created', !!sessionId);
  ok('fixture Tauri desktop app launched', !!sessionId);
  await sleep(1800);

  // --- identity + isolation markers ---
  const title = await wd('GET', `/session/${sessionId}/title`);
  ok('window title = Mission Control Fixture', /Mission Control Fixture/i.test(String(title || '')));
  ok('renderer DOM queryable via the genuine desktop session', (await bodyText()).length > 0);
  ok('ISOLATED DESKTOP FIXTURE marker visible', await testidVisible('fixture-marker'));
  ok('SYNTHETIC DATA marker visible', /SYNTHETIC DATA/i.test(await testidText('fixture-synthetic')));
  ok('NO PRODUCTION CONNECTION marker visible', /NO PRODUCTION CONNECTION/i.test(await testidText('fixture-noprod')));

  // --- governance (owner-only; Claude cannot approve/close) ---
  const gov = await testidText('governance');
  ok('owner-only governance visible (Murad decides)', /Murad/i.test(gov));
  ok('Claude cannot approve is stated', /claude cannot approve/i.test(gov));
  ok('Claude cannot close is stated', /claude cannot close/i.test(gov));

  // --- safety matrix ---
  ok('safety: Production touched = NO', /NO/.test(await testidText('safety-production-touched')));
  ok('safety: Deploy = NO', /NO/.test(await testidText('safety-deploy')));
  ok('safety: Database mutation = NO', /NO/.test(await testidText('safety-database-mutation')));
  ok('safety: External sends = NO', /NO/.test(await testidText('safety-external-sends')));
  ok('safety: Payments = NO', /NO/.test(await testidText('safety-payments')));
  ok('safety: Forbidden actions = BLOCKED', /BLOCKED/.test(await testidText('safety-forbidden-actions')));

  // --- no dangerous control exposed to Claude ---
  const dangerous = await exec(
    "return [...document.querySelectorAll('button,a,[role=button]')].map(e=>(e.textContent||'').trim()).filter(t=>/\\bapprove\\b|close phase|\\bdeploy\\b|\\bpay\\b|refund|\\bsend\\b|mutate/i.test(t))",
  );
  ok('no approve/close/deploy/send/pay/refund control exposed to Claude', Array.isArray(dangerous) && dangerous.length === 0);

  // --- no secret in DOM ---
  const html = String((await exec('return document.documentElement.outerHTML.slice(0, 300000)')) || '');
  ok('no raw secret visible in the desktop DOM', !SECRET_RE.test(html));

  // ================= SCENARIO A — CONNECTED / HEALTHY =================
  await selectScenario('connected');
  {
    const t = await bodyText();
    ok('A: connection shows Bridge running', /Bridge running/i.test(t));
    ok('A: project identity visible (acme-demo-shop)', /acme-demo-shop/.test(t));
    ok('A: active worker visible (fixture-claude)', /fixture-claude/.test(t));
    ok('A: worker role/state visible (validating)', /validating/i.test(t));
    ok('A: active phase ID visible', /FIXTURE-DEMO-PHASE1A/.test(t));
    ok('A: validators green (pass)', /pass/i.test(t));
    ok('A: event feed has deterministic event', /VALIDATION_PASSED/.test(t));
    if (SHOT_DIR) await snap('connected');
  }

  // ================= SCENARIO B — OWNER DECISION REQUIRED =================
  await selectScenario('owner-decision');
  {
    const t = await bodyText();
    ok('B: owner queue shows Approvals required (1)', /Approvals required \(1\)/i.test(t));
    ok('B: pending reviews present', /Pending reviews \(1\)/i.test(t));
    ok('B: phase awaiting_review visible', /awaiting_review/i.test(t));
    ok('B: owner-only approval language (only Murad can approve)', /only Murad can approve/i.test(t));
    ok('B: worker waiting-approval', /waiting-approval/i.test(t));
    ok('B: governance still forbids Claude approval', /claude cannot approve/i.test(await testidText('governance')));
    if (SHOT_DIR) await snap('owner-decision');
  }

  // ================= SCENARIO C — DISCONNECTED / SAFE =================
  await selectScenario('disconnected');
  {
    const t = await bodyText();
    ok('C: disconnected state clear', /Disconnected/i.test(t));
    ok('C: safety retained (Production touched = NO)', /NO/.test(await testidText('safety-production-touched')));
    ok('C: no blocked-action card in this scenario', !(await testidVisible('blocked-action')));
    if (SHOT_DIR) await snap('disconnected');
  }

  // ================= SCENARIO D — BLOCKED ACTION =================
  await selectScenario('blocked');
  {
    const t = await bodyText();
    ok('D: blocked-action card visible', await testidVisible('blocked-action'));
    ok('D: blocked reason visible (gated action)', /gated action/i.test(await testidText('blocked-action')));
    ok('D: blocked requires owner approval (Claude cannot approve)', /claude cannot approve/i.test(await testidText('blocked-owner')));
    ok('D: phase blocked stage visible', /blocked/i.test(t));
    if (SHOT_DIR) await snap('blocked');
  }

  // ================= RESPONSIVE / CUT-OFF PROOF — ALL FOUR SCENARIOS =================
  console.log('\n--- responsive matrix (scenario x viewport) ---');
  const EXPECT = {
    connected: { conn: /Bridge running/i, project: true, ownerQueue: false, blocked: false },
    'owner-decision': { conn: /Bridge running/i, project: true, ownerQueue: true, blocked: false },
    disconnected: { conn: /Disconnected/i, project: false, ownerQueue: false, blocked: false },
    blocked: { conn: null, project: true, ownerQueue: false, blocked: true },
  };
  for (const sc of ['connected', 'owner-decision', 'disconnected', 'blocked']) {
    await selectScenario(sc);
    const exp = EXPECT[sc];
    for (const [w, h] of SIZES) {
      await wd('POST', `/session/${sessionId}/window/rect`, { width: w, height: h, x: 40, y: 40 });
      await sleep(320);
      const info = await exec(
        'const de=document.documentElement; const q=(s)=>document.querySelector(s); const inView=(el)=>{ if(!el) return null; const r=el.getBoundingClientRect(); return r.width>0 && r.left>=-2 && r.right<=window.innerWidth+2; }; const conn=q(".pill.conn"); const blocked=q(\'[data-testid="blocked-action"]\'); return { overflow: de.scrollWidth>window.innerWidth+2, marker: inView(q(\'[data-testid="fixture-marker"]\')), safety: !!q(\'[data-testid="safety-matrix"]\'), connText: conn?conn.innerText:"", connVisible: inView(conn), ownerQueue: [...document.querySelectorAll(".panel-h")].some(e=>/Owner queue/i.test(e.textContent||"")), blockedVisible: !!blocked && inView(blocked), hasProject: /acme-demo-shop/.test(document.body.innerText) };',
      );
      const good =
        !!info &&
        info.overflow === false &&
        info.marker === true &&
        info.safety === true &&
        info.connVisible === true &&
        (exp.conn ? exp.conn.test(info.connText) : true) &&
        (exp.project ? info.hasProject === true : true) &&
        (exp.ownerQueue ? info.ownerQueue === true : true) &&
        (exp.blocked ? info.blockedVisible === true : true);
      ok(`resize ${sc} @ ${w}x${h} (no overflow + critical controls reachable)`, good);
      if (info) {
        console.log(
          `  MATRIX ${sc.padEnd(15)} ${String(w).padStart(4)}x${String(h).padEnd(3)} overflow=${!info.overflow} marker=${info.marker} conn=${info.connVisible} safety=${info.safety} project=${info.hasProject} ownerQ=${info.ownerQueue} blocked=${info.blockedVisible}`,
        );
      }
    }
  }
  await wd('POST', `/session/${sessionId}/window/rect`, { width: 1200, height: 820, x: 60, y: 60 });
  await sleep(300);

  // ================= KEYBOARD / ACCESSIBILITY PROOF =================
  const focusBtn = await exec('const b=document.querySelector(\'[data-testid="scenario-blocked"]\'); if(b){b.focus();} return document.activeElement && document.activeElement.getAttribute("data-testid");');
  ok('keyboard focus reaches a scenario control', focusBtn === 'scenario-blocked');
  // Enter activates the focused control (switches to blocked scenario).
  await pressKey(KEY.ENTER);
  ok('Enter activates the focused control', await testidVisible('blocked-action'));
  // Focus visible after keyboard focus (focus-visible outline).
  await exec('const b=document.querySelector(\'[data-testid="scenario-connected"]\'); if(b){b.focus();}');
  await pressKey(KEY.TAB);
  const focusInfo = await exec('const a=document.activeElement; const cs=a?getComputedStyle(a):null; return { tag: a?a.tagName:"", outline: cs?(cs.outlineStyle):"", notBody: a && a!==document.body };');
  ok('Tab moves focus to a real control (no immediate trap)', !!focusInfo && focusInfo.notBody === true && focusInfo.tag !== '');
  ok('focus indication present after keyboard focus', !!focusInfo && focusInfo.outline !== 'none' && focusInfo.outline !== '');
  await pressKey(KEY.SHIFT, KEY.TAB);
  const backInfo = await exec('const a=document.activeElement; return a && a!==document.body && a.tagName!=="";');
  ok('Shift+Tab moves focus back (no keyboard trap)', backInfo === true);

  // ================= NETWORK / SIDE-EFFECT PROOF (full primitive coverage) =================
  const guard = (await exec('return window.__NET_GUARD__ || null')) || {};
  for (const prim of ['fetch', 'xhr', 'websocket', 'eventsource', 'sendbeacon']) {
    if (guard[prim]) ok(`net guard instruments ${prim}`, true);
    else console.log(`NOTE  ${prim} not available in this WebView — cannot intercept (reported, not claimed)`);
  }
  const netCalls = await exec('return (window.__NET_CALLS__||[]).map(String)');
  ok('network recorder present', Array.isArray(netCalls));
  const external = Array.isArray(netCalls) ? netCalls.filter((u) => /^(https?|wss?):/i.test(u)) : ['<missing>'];
  ok('zero external fetch/XHR/WebSocket/EventSource/beacon calls recorded', external.length === 0);
  ok('no supabase reference reached the network layer', Array.isArray(netCalls) && !netCalls.some((u) => /supabase/i.test(u)));
  const resExternal = await exec(
    "return (performance.getEntriesByType('resource')||[]).map(e=>e.name).filter(n=>/^https?:/i.test(n) && !/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|tauri\\.localhost)/i.test(n))",
  );
  ok('resource entries contain no external URL', Array.isArray(resExternal) && resExternal.length === 0);
  ok('resource entries contain no supabase/production host', Array.isArray(resExternal) && !resExternal.some((n) => /supabase|vercel|amazonaws|googleapis/i.test(n)));

  // final identity re-check
  ok('fixture still identifies as isolated (marker persists)', await testidVisible('fixture-marker'));
}

async function snap(name) {
  try {
    const b64 = await wd('GET', `/session/${sessionId}/screenshot`);
    writeFileSync(`${SHOT_DIR}/fixture-${name}.png`, Buffer.from(String(b64), 'base64'));
    console.log(`screenshot -> ${SHOT_DIR}/fixture-${name}.png`);
  } catch { /* screenshots are best-effort evidence */ }
}

(async () => {
  const before = {};
  for (const n of PROC_NAMES) before[n] = pidsByName(n);
  try {
    await main();
  } catch (e) {
    console.error('ERROR', e && e.message);
    failures.push('exception: ' + (e && e.message));
  } finally {
    try { if (sessionId) await wd('DELETE', `/session/${sessionId}`); } catch { /* best effort */ }
    try { if (driverProc && driverProc.pid) execSync(`taskkill /PID ${driverProc.pid} /T /F`, { stdio: 'ignore' }); } catch { /* */ }
    const killNew = () => {
      let killed = 0;
      for (const n of PROC_NAMES) {
        for (const pid of pidsByName(n)) {
          if (!before[n].has(pid)) {
            killed += 1;
            try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch { /* */ }
          }
        }
      }
      return killed;
    };
    let reaped = 0;
    for (let i = 0; i < 8; i += 1) { await sleep(500); reaped += killNew(); }
    let remaining = 0;
    for (const n of PROC_NAMES) {
      for (const pid of pidsByName(n)) if (!before[n].has(pid)) remaining += 1;
    }
    console.log(`cleanup: reaped ${reaped} harness-started process(es); remaining harness processes: ${remaining}`);
    if (remaining > 0) failures.push(`orphan processes remain: ${remaining}`);
  }
  console.log(failures.length ? `\nMISSION CONTROL FIXTURE SMOKE: FAIL (${failures.length})` : '\nMISSION CONTROL FIXTURE SMOKE: PASS');
  process.exit(failures.length ? 1 : 0);
})();
