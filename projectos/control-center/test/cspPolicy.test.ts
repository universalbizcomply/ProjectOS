import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs shared with the webview harness; it has no types and needs none.
import { judge, outcome, samePolicy } from './csp-webview/verdict.mjs';
// @ts-expect-error -- as above.
import { CONTROL_CENTER, committedDevPolicy, committedPolicy, parsePolicy, policySupabaseHost, variants } from './csp-webview/variants.mjs';

const HOST = 'vzbzkziksxvyfqrdrwqx.supabase.co';
const SHELL = { profile: 'shell', csp: committedPolicy() as string, expect: 'pass' };
const LOGIN = { profile: 'login', csp: committedPolicy() as string, expect: 'pass' };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}
const SOURCES = sourceFiles(join(CONTROL_CENTER, 'src')).map((path) => readFileSync(path, 'utf8'));

const blockedProbes = () => ({
  inlineScript: { attempted: true, effect: false },
  evalCall: { attempted: true, effect: false },
  foreignFetch: { attempted: true, effect: false, hits: 0 },
  siblingProject: { attempted: true, effect: false, blockedByPolicy: true },
  foreignImage: { attempted: true, effect: false, hits: 0 },
  inlineStyle: { attempted: true, effect: false },
  styleAttribute: { attempted: true, effect: false },
  cssomStyle: { attempted: true, effect: true },
  baseUri: { attempted: true, effect: false },
  objectEmbed: { attempted: true, effect: false, hits: 0 },
  formAction: { attempted: true, effect: false, hits: 0 },
});
const PROBE_VIOLATIONS = ['script-src-elem', 'script-src', 'connect-src', 'img-src', 'style-src-elem', 'style-src-attr', 'base-uri', 'object-src', 'form-action']
  .map((directive) => ({ directive }));

const NO_NODE_GLOBALS = { Buffer: 'undefined', process: 'undefined', global: 'undefined', require: 'undefined', setImmediate: 'undefined' };

const passingShell = () => ({
  servedPolicy: committedPolicy() as string,
  nodeGlobals: NO_NODE_GLOBALS,
  loaded: { rendered: true, elements: 400 },
  fonts: { bundledLoaded: true, widthDiffers: true, requested: [{}] },
  normalUseRan: true,
  violations: [],
  consoleViolations: [],
  sidecar: { state: 'RUNNING_READ_ONLY', messages: 3 },
  ipcNative: 12,
  walked: ['Projects', 'Execution', 'Control Center', 'Health', 'Settings'],
  capability: { windowDenied: true, openerDenied: true },
  probes: blockedProbes(),
  probeViolations: PROBE_VIOLATIONS,
});
const passingLogin = () => ({
  servedPolicy: committedPolicy() as string,
  nodeGlobals: NO_NODE_GLOBALS,
  loaded: { rendered: true, elements: 30 },
  fonts: { bundledLoaded: true, widthDiffers: true, requested: [{}] },
  normalUseRan: true,
  violations: [],
  consoleViolations: [],
  signIn: { attempted: true, status: 400, host: HOST, policyHost: HOST, path: '/auth/v1/token', shownError: 'Invalid login credentials', requests: 1, preflights: 1 },
});
const failing = (verdict: { checks: { id: string; ok: boolean }[] }) =>
  verdict.checks.filter((check) => !check.ok).map((check) => check.id);

describe('the committed policy', () => {
  const policy = parsePolicy(committedPolicy()) as Record<string, string[]>;
  const dev = parsePolicy(committedDevPolicy()) as Record<string, string[]>;

  it('has no wildcard host and no unsafe-eval, in either policy', () => {
    for (const text of [committedPolicy(), committedDevPolicy()] as string[]) {
      expect(text).not.toContain('*');
      expect(text).not.toContain('unsafe-eval');
    }
  });

  it('locks object-src, base-uri, form-action and frame-ancestors, in either policy', () => {
    for (const directives of [policy, dev]) {
      for (const name of ['object-src', 'base-uri', 'form-action', 'frame-ancestors']) {
        expect(directives[name]).toEqual(["'none'"]);
      }
    }
  });

  it('names the exact Supabase project and no other remote host', () => {
    expect(policySupabaseHost()).toBe(HOST);
    expect(policy['connect-src']).toEqual(["'self'", 'ipc:', 'http://ipc.localhost', `https://${HOST}`, `wss://${HOST}`]);
  });

  it('style-src runs without unsafe-inline in the built app; only the dev policy allows it, for Vite', () => {
    expect(policy['style-src']).toEqual(["'self'"]);
    expect(dev['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
  });
});

describe('what the frontend needs from the policy and the capability', () => {
  it('the capability says what is true: commands have no caller check, and the CSP is the barrier', () => {
    const { description } = JSON.parse(readFileSync(join(CONTROL_CENTER, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
    expect(description).not.toContain('authorised by their own Rust handlers');
    for (const command of ['set_credential', 'register_project', 'import_project_file']) expect(description).toContain(command);
    expect(description).toContain('the CSP');
  });

  it('the build rebuilds core first, then scans what it built, so a stale dist cannot reach the bundle', () => {
    const { scripts } = JSON.parse(readFileSync(join(CONTROL_CENTER, 'package.json'), 'utf8'));
    const steps = (scripts.build as string).split(' && ');
    expect(steps).toEqual(['npm --prefix ../core run build', 'npm run build:renderer', 'node test/csp-webview/scan-bundle.cjs']);
    expect(scripts['build:renderer']).toBe('tsc -p tsconfig.json && vite build');
    expect(scripts['release:prepare']).toContain('npm run build &&');
  });

  it('the window holds exactly the two event permissions', () => {
    const capability = JSON.parse(readFileSync(join(CONTROL_CENTER, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
    expect(capability.windows).toEqual(['main']);
    expect(capability.permissions).toEqual(['core:event:allow-listen', 'core:event:allow-unlisten']);
  });

  it('the frontend imports only the Tauri core and event modules, so nothing it uses was narrowed away', () => {
    const imports = SOURCES.flatMap((text) => [...text.matchAll(/['"](@tauri-apps\/[^'"]+)['"]/g)].map((match) => match[1]));
    expect(new Set(imports)).toEqual(new Set(['@tauri-apps/api/core', '@tauri-apps/api/event']));
    expect(SOURCES.some((text) => /['"`]plugin:/.test(text))).toBe(false);
  });

  it('the frontend has no route that writes inline style or script as markup', () => {
    const route = /<style[\s>]|dangerouslySetInnerHTML|setAttribute\(\s*['"]style|document\.write|\binsertAdjacentHTML\b|\.(?:inner|outer)HTML\s*\+?=|\bsrcdoc\b|\beval\(|new Function\(/;
    expect(SOURCES.filter((text) => route.test(text))).toEqual([]);
  });

  it('the frontend opens no connection of its own: Supabase and the IPC are the only callers', () => {
    const connection = /\bfetch\(|new WebSocket\(|new EventSource\(|new XMLHttpRequest\(|navigator\.sendBeacon\(|new (?:Shared)?Worker\(|importScripts\(|serviceWorker\.register\(/;
    expect(SOURCES.filter((text) => connection.test(text))).toEqual([]);
    const remote = /<(?:img|script|link|iframe|audio|video|source|object|embed)\b[^>]*\b(?:src|href|data|srcSet)=\{?["'`]https?:/;
    expect(SOURCES.filter((text) => remote.test(text))).toEqual([]);
  });
});

describe('the judge never passes silence', () => {
  it('a complete shell run passes: the positive control for everything below', () => {
    expect(judge(passingShell(), SHELL)).toMatchObject({ pass: true });
  });

  it('a complete login run passes', () => {
    expect(judge(passingLogin(), LOGIN)).toMatchObject({ pass: true });
  });

  it('a blank window fails, though it reports no violation at all', () => {
    const verdict = judge({ servedPolicy: committedPolicy(), loaded: { rendered: false, elements: 0 }, violations: [], consoleViolations: [] }, SHELL);
    expect(verdict.pass).toBe(false);
    expect(failing(verdict)).toEqual(expect.arrayContaining(['app-loaded', 'no-violation', 'sidecar-reached', 'bundled-fonts']));
  });

  it('a probe that never ran fails rather than counting as blocked', () => {
    const obs = passingShell();
    const { inlineScript: _dropped, ...rest } = obs.probes;
    expect(failing(judge({ ...obs, probes: rest }, SHELL))).toEqual(['inline-script-blocked']);
  });

  it('a probe with no effect but no violation fails: something else may have stopped it', () => {
    const obs = { ...passingShell(), probeViolations: PROBE_VIOLATIONS.filter((v) => v.directive !== 'connect-src') };
    expect(failing(judge(obs, SHELL))).toEqual(['foreign-fetch-blocked']);
  });

  it('a violation with the effect still present fails: the thing happened', () => {
    const obs = passingShell();
    const probes = { ...obs.probes, inlineScript: { attempted: true, effect: true } };
    expect(failing(judge({ ...obs, probes }, SHELL))).toEqual(['inline-script-blocked']);
  });

  it('a foreign request that arrived fails, whatever the page said', () => {
    const obs = passingShell();
    const probes = { ...obs.probes, foreignFetch: { attempted: true, effect: false, hits: 1 } };
    expect(failing(judge({ ...obs, probes }, SHELL))).toEqual(['foreign-fetch-blocked']);
  });

  it('a webview exposing a Node global fails: a rendered app would then prove nothing about loading without one', () => {
    expect(failing(judge({ ...passingShell(), nodeGlobals: { ...NO_NODE_GLOBALS, Buffer: 'function' } }, SHELL))).toEqual(['no-node-globals']);
    expect(failing(judge({ ...passingShell(), nodeGlobals: undefined }, SHELL))).toEqual(['no-node-globals']);
  });

  it('IPC that fell back to postMessage fails, though the app still works', () => {
    expect(failing(judge({ ...passingShell(), ipcNative: 0 }, SHELL))).toEqual(['ipc-native']);
  });

  it('one console line of a CSP refusal fails the run', () => {
    expect(failing(judge({ ...passingShell(), consoleViolations: ['Refused to connect'] }, SHELL))).toEqual(['no-violation']);
  });

  it('the policy is compared by directive, and a missing one is a different policy', () => {
    const reordered = (committedPolicy() as string).split('; ').reverse().join('; ');
    expect(samePolicy(reordered, committedPolicy())).toBe(true);
    const hashed = (committedPolicy() as string).replace("script-src 'self'", "script-src 'self' 'sha256-zhqeGqEdNbM1aa367VZOXyESDSczXtz4QVOUpJfASo0='");
    expect(samePolicy(hashed, committedPolicy())).toBe(true);
    const hashedStyle = (committedPolicy() as string).replace("style-src 'self'", "style-src 'self' 'sha256-zhqeGqEdNbM1aa367VZOXyESDSczXtz4QVOUpJfASo0='");
    expect(samePolicy(hashedStyle, committedPolicy())).toBe(false);
    expect(samePolicy((committedPolicy() as string).replace(" base-uri 'none';", ''), committedPolicy())).toBe(false);
    expect(failing(judge({ ...passingShell(), servedPolicy: null }, SHELL))).toEqual(['served-policy']);
  });

  it('a build with no policy cannot pass the served-policy check by matching nothing', () => {
    const noPolicy = { ...SHELL, csp: null };
    expect(failing(judge({ ...passingShell(), servedPolicy: null }, noPolicy))).toContain('served-policy');
  });

  it('a sign-in that reached another host, or returned nothing, fails', () => {
    const obs = passingLogin();
    expect(failing(judge({ ...obs, signIn: { ...obs.signIn, host: 'other.supabase.co' } }, LOGIN))).toEqual(['supabase-reached']);
    expect(failing(judge({ ...obs, signIn: { ...obs.signIn, status: undefined } }, LOGIN))).toEqual(['supabase-reached']);
  });

  it('a second sign-in request fails: one was allowed', () => {
    const obs = passingLogin();
    expect(failing(judge({ ...obs, signIn: { ...obs.signIn, requests: 2 } }, LOGIN))).toEqual(['exactly-one-request']);
  });

  it('a no-request run fails if anything reached the host', () => {
    const quiet = { ...LOGIN, noRequest: true };
    const signIn = { attempted: false, requests: 0, preflights: 0, otherOnHost: 0 };
    expect(judge({ ...passingLogin(), signIn }, quiet)).toMatchObject({ pass: true });
    expect(failing(judge({ ...passingLogin(), signIn: { ...signIn, preflights: 1 } }, quiet))).toEqual(['nothing-sent']);
    expect(failing(judge({ ...passingLogin(), signIn: { ...signIn, attempted: true } }, quiet))).toEqual(['nothing-sent']);
    expect(failing(judge({ ...passingLogin(), signIn: undefined }, quiet))).toEqual(['nothing-sent']);
  });

  it('the preflight is not a second sign-in', () => {
    const obs = passingLogin();
    expect(failing(judge({ ...obs, signIn: { ...obs.signIn, preflights: 1 } }, LOGIN))).toEqual([]);
  });

  it('dev policy: inline style must apply there, and the strict policy must stop it', () => {
    const obs = passingShell();
    const probes = { ...obs.probes, inlineStyle: { attempted: true, effect: true }, styleAttribute: { attempted: true, effect: true } };
    expect(failing(judge({ ...obs, probes }, { ...SHELL, inlineStyleAllowed: true }))).toEqual([]);
    expect(failing(judge({ ...obs, probes }, SHELL))).toEqual(['inline-style-blocked', 'style-attribute-blocked']);
  });
});

describe('a control proves something only by failing where it says', () => {
  const control = { ...SHELL, expect: 'fail', mustFailAt: 'bundled-fonts', mustStillPass: ['app-loaded'] };
  const verdict = (failed: string[]) => ({
    pass: false,
    checks: [...failed.map((id) => ({ id, ok: false, detail: '' })), { id: 'app-loaded', ok: true, detail: '' }],
  });

  it('failing at the named check counts', () => {
    expect(outcome(control, verdict(['bundled-fonts']))).toBe(true);
  });

  it('a blank window fails the named check for the wrong reason, and that proves nothing', () => {
    const blank = { pass: false, checks: [{ id: 'bundled-fonts', ok: false, detail: '' }, { id: 'app-loaded', ok: false, detail: '' }] };
    expect(outcome(control, blank)).toBe(false);
  });

  it('a control naming nothing it leaves alone proves nothing', () => {
    expect(outcome({ ...control, mustStillPass: [] }, verdict(['bundled-fonts']))).toBe(false);
  });

  it('failing somewhere else does not', () => {
    expect(outcome(control, { pass: false, checks: [{ id: 'bundled-fonts', ok: true, detail: '' }, { id: 'app-loaded', ok: true, detail: '' }, { id: 'no-violation', ok: false, detail: '' }] })).toBe(false);
  });

  it('passing does not', () => {
    expect(outcome(control, { pass: true, checks: [{ id: 'bundled-fonts', ok: true, detail: '' }] })).toBe(false);
  });

  it('every control names the check its removal has to break, and each is a real check', () => {
    const table = variants() as Record<string, { expect: string; mustFailAt?: string; mustStillPass?: string[]; profile: string; csp: string | null }>;
    const known = [...judge(passingShell(), SHELL).checks, ...judge(passingLogin(), LOGIN).checks].map((check: { id: string }) => check.id);
    for (const entry of Object.values(table).filter((row) => row.expect === 'fail')) {
      expect(known).toContain(entry.mustFailAt);
      expect(entry.mustStillPass?.length).toBeGreaterThan(0);
      for (const id of entry.mustStillPass ?? []) expect(known).toContain(id);
      expect(entry.mustStillPass).not.toContain(entry.mustFailAt);
    }
  });

  it('the production build is the only frontend build: the harness carries no Vite config or stand-in of its own', () => {
    const route = readdirSync(join(CONTROL_CENTER, 'test', 'csp-webview'));
    expect(route.filter((name) => /vite|stub|shim/i.test(name))).toEqual([]);
    const build = readFileSync(join(CONTROL_CENTER, 'test', 'csp-webview', 'build-variant.mjs'), 'utf8');
    expect(build).toContain("npm('build', CONTROL_CENTER, viteEnv);");
    expect(build).not.toMatch(/vite\.js|'--config', join\(CONTROL_CENTER/);
  });

  it('the control that restores the old bug names the blank window as its failure', () => {
    const table = variants() as Record<string, { mustFailAt?: string; sourceEdit?: { to: string } }>;
    expect(table['control-eager-node-global']?.mustFailAt).toBe('app-loaded');
    expect(table['control-eager-node-global']?.sourceEdit?.to).toContain('Buffer.from(');
  });

  it('exactly one variant may reach Supabase', () => {
    const table = variants() as Record<string, { signIn?: boolean }>;
    expect(Object.entries(table).filter(([, row]) => row.signIn === true).map(([name]) => name)).toEqual(['strict-login']);
  });

  it('the no-Supabase control names no Supabase host at all', () => {
    const table = variants() as Record<string, { csp: string }>;
    expect(table['control-no-supabase']?.csp).not.toContain('supabase.co');
  });
});
