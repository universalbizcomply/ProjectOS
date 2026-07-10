#!/usr/bin/env node
/**
 * ProjectOS Control Center — raw tauri-driver desktop smoke (opt-in, local-only).
 *
 * Zero external deps: Node's global fetch speaks the WebDriver HTTP protocol directly to
 * `tauri-driver` (localhost). No WebdriverIO/@wdio stack, no Tauri test plugin, no app changes,
 * no auth bypass. Proves a genuine desktop session: app launches, renderer is queryable, the
 * login wall is safe, nothing dangerous is exposed, layout survives resizing, and everything
 * this harness started is cleaned up (pid-diff — never touches processes it did not start).
 *
 * Env:
 *   MSEDGEDRIVER   (required on Windows) path to a msedgedriver.exe matching the installed Edge
 *   PROJECTOS_APP  (required) path to the built projectos-control-center executable
 *   PROJECTOS_SHOT (optional) path to write a login-screen screenshot (no secrets on this screen)
 *
 * Exit 0 = genuine pass; non-zero = genuine failure. Never wired into build/validate.
 */
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PROJECTOS_WD_PORT || 4444);
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.PROJECTOS_APP;
const DRIVER = process.env.MSEDGEDRIVER;
const SHOT = process.env.PROJECTOS_SHOT || null;
const PROC_NAMES = ['tauri-driver.exe', 'msedgedriver.exe', 'projectos-control-center.exe'];

if (!APP || !DRIVER) {
  console.error('Required: PROJECTOS_APP=<exe> and MSEDGEDRIVER=<msedgedriver.exe>');
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

const SECRET_RE =
  /sbp_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{15,}|vcp_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}|password['" ]*[:=]['" ]*\S{4,}/;

async function main() {
  driverProc = spawn('tauri-driver', ['--port', String(PORT), '--native-driver', DRIVER], { stdio: 'ignore' });
  const up = await waitDriver();
  ok('tauri-driver starts + serves on 127.0.0.1 (localhost only)', up);
  if (!up) throw new Error('tauri-driver did not become ready');

  const res = await wd('POST', '/session', {
    capabilities: { alwaysMatch: { 'tauri:options': { application: APP } } },
  });
  sessionId = res && (res.sessionId || res['sessionId']);
  ok('WebDriver session created', !!sessionId);
  ok('ProjectOS Tauri desktop app launched', !!sessionId);
  await sleep(1800);

  const title = await wd('GET', `/session/${sessionId}/title`);
  ok('desktop window has ProjectOS identity', /ProjectOS|Control Center/i.test(String(title || '')));

  const bodyText = String((await exec('return document.body ? document.body.innerText : ""')) || '');
  ok('renderer DOM queryable via the genuine desktop session', bodyText.length > 0);
  ok('login wall visible (unauthenticated, no bypass)', /sign in/i.test(bodyText));

  const html = String((await exec('return document.documentElement.outerHTML.slice(0, 300000)')) || '');
  ok('no raw secret visible in the desktop DOM', !SECRET_RE.test(html));

  const dangerous = await exec(
    "return [...document.querySelectorAll('button,a,[role=button]')].map(e=>(e.textContent||'').trim()).filter(t=>/\\bapprove\\b|close phase|\\bdeploy\\b|\\bdelete\\b|\\bpay\\b|refund|\\bsend\\b|mutate/i.test(t))",
  );
  ok('no approve/close/deploy/send/pay/refund control exposed to Claude', Array.isArray(dangerous) && dangerous.length === 0);

  for (const [w, h] of [[1440, 900], [1024, 768], [800, 700], [640, 700]]) {
    await wd('POST', `/session/${sessionId}/window/rect`, { width: w, height: h, x: 60, y: 60 });
    await sleep(350);
    const info = await exec(
      'const de=document.documentElement; const c=document.querySelector(".login-card")||document.querySelector("form"); const cr=c?c.getBoundingClientRect():null; return { overflow: de.scrollWidth>window.innerWidth+2, cardInView: cr?(cr.left>=-2 && cr.right<=window.innerWidth+2):false };',
    );
    ok(`no horizontal overflow @ ${w}x${h}`, !!info && info.overflow === false);
    ok(`login card fully in view @ ${w}x${h}`, !!info && info.cardInView === true);
  }

  const focusOk = await exec('const i=document.querySelector("input"); if(i){i.focus();} return !!document.activeElement && document.activeElement.tagName==="INPUT";');
  ok('keyboard focus reaches a genuine input control', focusOk === true);

  if (SHOT) {
    const b64 = await wd('GET', `/session/${sessionId}/screenshot`);
    writeFileSync(SHOT, Buffer.from(String(b64), 'base64'));
    console.log('screenshot ->', SHOT);
  }
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
    // pid-diff cleanup: kill ONLY processes that appeared after we started (never the owner's).
    // msedgedriver tears the app down asynchronously after the session ends, and the app pid can
    // re-materialise just after a single sweep — so settle + retry-sweep until nothing lingers.
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
  console.log(failures.length ? `\nDESKTOP SMOKE: FAIL (${failures.length})` : '\nDESKTOP SMOKE: PASS');
  process.exit(failures.length ? 1 : 0);
})();
