/**
 * THE BUILDS THE WEBVIEW PROOF RUNS AGAINST — PROJECTOS-TENANT-CSP1A.
 *
 * Two carry the committed policy. The rest each take one rule away, through the Tauri CLI's `--config`
 * merge, so tauri.conf.json is never edited to run them. A proof counts only if removing its rule makes
 * it fail, so every `mustFailAt` below names the one check that removal has to break.
 *
 * `profile` picks the app the build holds. `shell` is built with no Supabase settings, so the auth gate
 * is off and the real shell mounts and reaches the sidecar. `login` is built with them, so the app stops
 * at the sign-in screen. The shell sits behind a session, and this proof has no password.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const CONTROL_CENTER = resolve(here, '..', '..');
export const CONF_PATH = resolve(CONTROL_CENTER, 'src-tauri', 'tauri.conf.json');

/**
 * The loopback port the proof build's webview opens for DevTools. Built in, not passed at launch: wry sets
 * WebView2's browser arguments explicitly, and that option wins over WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
 * It reaches proof builds only, through the `--config` merge. tauri.conf.json never carries it.
 */
export const DEBUG_PORT = 19517;
/** wry's own default arguments, kept, because setting this option replaces them. */
export const PROOF_BROWSER_ARGS = `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=${DEBUG_PORT}`;

export function committedConf() {
  return JSON.parse(readFileSync(CONF_PATH, 'utf8'));
}

export function committedPolicy() {
  return committedConf().app.security.csp;
}

export function committedDevPolicy() {
  return committedConf().app.security.devCsp;
}

/** The directives of a policy, as a map of name to source list. */
export function parsePolicy(policy) {
  const directives = {};
  for (const part of String(policy).split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives[name] = sources;
  }
  return directives;
}

/** The same policy with one directive's sources replaced. Comparison is by directive, not by text. */
function withDirective(policy, name, change) {
  const directives = parsePolicy(policy);
  directives[name] = change(directives[name]);
  return Object.entries(directives)
    .map(([key, sources]) => [key, ...sources].join(' '))
    .join('; ');
}

const SUPABASE_HTTPS = /^https:\/\/[a-z0-9]+\.supabase\.co$/;
const SUPABASE_WSS = /^wss:\/\/[a-z0-9]+\.supabase\.co$/;

export const WIDE_CAPABILITY = {
  identifier: 'default',
  windows: ['main'],
  permissions: ['core:default', 'core:event:default', 'opener:default', 'opener:allow-open-url'],
};

/**
 * Each entry: `csp` is the policy built in, `extra` is any further merge. `signIn` is true on exactly one
 * entry that can reach Supabase. The no-Supabase control drives the same form, and the policy stops it
 * before anything leaves the machine.
 */
export function variants() {
  const strict = committedPolicy();
  return {
    'strict-shell': { profile: 'shell', csp: strict, expect: 'pass' },
    'strict-login': { profile: 'login', csp: strict, expect: 'pass', signIn: true },
    'dev-policy-shell': {
      profile: 'shell',
      csp: committedDevPolicy(),
      expect: 'pass',
      note: 'devCsp built in as the served policy. Its inline-style allowance is the one expected difference.',
      inlineStyleAllowed: true,
    },
    // The bug that blanked the app from 2026-09-25: one Buffer.from while core loads, in the real build.
    'control-eager-node-global': {
      profile: 'shell',
      csp: strict,
      sourceEdit: {
        file: 'projectos/core/src/hostReviewWire.ts',
        from: 'export const HOST_WIRE_PROTOCOL_VERSION = 1;',
        to: "export const HOST_LOAD_PROBE = Buffer.from('POS1', 'ascii');\nexport const HOST_WIRE_PROTOCOL_VERSION = 1;",
      },
      expect: 'fail',
      mustFailAt: 'app-loaded',
      mustStillPass: ['served-policy', 'no-node-globals'],
    },
    'control-no-policy': {
      profile: 'shell',
      csp: null,
      expect: 'fail',
      mustFailAt: 'served-policy',
      mustStillPass: ['app-loaded', 'bundled-fonts', 'sidecar-reached', 'no-violation'],
    },
    'control-loose-script-style': {
      profile: 'shell',
      csp: withDirective(
        withDirective(strict, 'script-src', () => ["'self'", "'unsafe-inline'", "'unsafe-eval'"]),
        'style-src',
        () => ["'self'", "'unsafe-inline'"],
      ),
      // eval, not inline script. Tauri's bundle hashes sit in the served script-src, and a browser ignores
      // 'unsafe-inline' once a hash is present, so an inline script stayed blocked in this control.
      expect: 'fail',
      mustFailAt: 'eval-blocked',
      mustStillPass: ['served-policy', 'app-loaded', 'sidecar-reached', 'foreign-fetch-blocked', 'inline-script-blocked'],
    },
    'control-no-ipc': {
      profile: 'shell',
      csp: withDirective(strict, 'connect-src', (sources) =>
        sources.filter((source) => source !== 'ipc:' && source !== 'http://ipc.localhost'),
      ),
      expect: 'fail',
      mustFailAt: 'no-violation',
      mustStillPass: ['served-policy', 'app-loaded', 'sidecar-reached'],
    },
    'control-no-fonts': {
      profile: 'shell',
      csp: withDirective(strict, 'font-src', () => ["'none'"]),
      expect: 'fail',
      mustFailAt: 'bundled-fonts',
      mustStillPass: ['served-policy', 'app-loaded', 'sidecar-reached'],
    },
    'control-no-script': {
      profile: 'shell',
      csp: withDirective(strict, 'script-src', () => ["'none'"]),
      // Without this Tauri puts 'self' back beside its bundle hashes, so 'none' alone cannot blank the app.
      extra: { app: { security: { dangerousDisableAssetCspModification: ['script-src'] } } },
      expect: 'fail',
      mustFailAt: 'app-loaded',
      mustStillPass: ['served-policy'],
    },
    'control-no-supabase': {
      profile: 'login',
      csp: withDirective(strict, 'connect-src', (sources) =>
        sources.filter((source) => !SUPABASE_HTTPS.test(source) && !SUPABASE_WSS.test(source)),
      ),
      expect: 'fail',
      mustFailAt: 'supabase-reached',
      mustStillPass: ['served-policy', 'app-loaded', 'bundled-fonts'],
      blockedSignIn: true,
    },
    'control-wide-capability': {
      profile: 'shell',
      csp: strict,
      extra: { app: { security: { capabilities: [WIDE_CAPABILITY] } } },
      expect: 'fail',
      mustFailAt: 'capability-narrow',
      mustStillPass: ['served-policy', 'app-loaded', 'sidecar-reached', 'inline-script-blocked'],
    },
  };
}

/** The Supabase address the committed policy names, and the only one this proof may talk to. */
export function policySupabaseHost() {
  const source = parsePolicy(committedPolicy())['connect-src'].find((item) => SUPABASE_HTTPS.test(item));
  return source === undefined ? null : new URL(source).host;
}
