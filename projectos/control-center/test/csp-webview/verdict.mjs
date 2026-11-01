/**
 * THE JUDGE OF ONE WEBVIEW RUN — PROJECTOS-TENANT-CSP1A.
 *
 * Pure, so it can be tested without a window. It sees only what the run observed. Every check starts from
 * "not shown": a probe that never ran, a page that never loaded and an app that never rendered all fail.
 * Silence is never a pass, because a blank window reports no CSP violations.
 *
 * A blocked probe needs both halves: the attempt had no effect AND the browser reported a violation of the
 * expected directive. Either alone can happen for another reason.
 */
import { parsePolicy } from './variants.mjs';

const BUNDLE_HASH = /^'sha256-[A-Za-z0-9+/]+=*'$/;

const normalise = (policy) =>
  Object.entries(parsePolicy(policy))
    .map(([name, sources]) => `${name} ${[...sources].sort().join(' ')}`)
    .sort();

/**
 * Tauri adds one hash to the served script-src for each bundled .js file (tauri-codegen embedded_assets),
 * and serialises the directives through a map. Those hashes admit only bytes the app already ships, so they
 * are not a change of policy. Anywhere else, a hash is.
 */
export function withoutBundleHashes(served) {
  const directives = parsePolicy(served);
  if (directives['script-src'] !== undefined) {
    directives['script-src'] = directives['script-src'].filter((source) => !BUNDLE_HASH.test(source));
  }
  return Object.entries(directives).map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
}

/** Same directives and same sources, in any order, once the served side has lost Tauri's bundle hashes. */
export function samePolicy(served, committed) {
  if (typeof served !== 'string' || typeof committed !== 'string') return false;
  return JSON.stringify(normalise(withoutBundleHashes(served))) === JSON.stringify(normalise(committed));
}

const violated = (obs, directive) =>
  (obs.probeViolations ?? []).some((v) => v.directive === directive);

const blocked = (probe, directive, obs) =>
  probe?.attempted === true && probe.effect === false && violated(obs, directive);

const COMMON = (obs, variant) => [
  ['served-policy', samePolicy(obs.servedPolicy, variant.csp) && variant.csp !== null, obs.servedPolicy === null ? 'no policy was served' : ''],
  ['app-loaded', obs.loaded?.rendered === true, `${obs.loaded?.elements ?? 0} elements`],
  // A webview has none of these, so a rendered app is the proof nothing needed one while it loaded.
  [
    'no-node-globals',
    ['Buffer', 'process', 'global', 'require', 'setImmediate'].every((name) => obs.nodeGlobals?.[name] === 'undefined'),
    JSON.stringify(obs.nodeGlobals ?? null),
  ],
  [
    'bundled-fonts',
    obs.fonts?.bundledLoaded === true && obs.fonts?.widthDiffers === true,
    `${(obs.fonts?.requested ?? []).length} woff2 fetched`,
  ],
  [
    'no-violation',
    obs.normalUseRan === true && (obs.violations ?? []).length === 0 && (obs.consoleViolations ?? []).length === 0,
    `${(obs.violations ?? []).length} events, ${(obs.consoleViolations ?? []).length} console lines`,
  ],
];

const SHELL = (obs, variant) => {
  const p = obs.probes ?? {};
  const styleElement = variant.inlineStyleAllowed === true
    ? p.inlineStyle?.attempted === true && p.inlineStyle.effect === true
    : blocked(p.inlineStyle, 'style-src-elem', obs);
  const styleAttribute = variant.inlineStyleAllowed === true
    ? p.styleAttribute?.attempted === true && p.styleAttribute.effect === true
    : blocked(p.styleAttribute, 'style-src-attr', obs);
  return [
    ['sidecar-reached', obs.sidecar?.state === 'RUNNING_READ_ONLY' && (obs.sidecar?.messages ?? 0) > 0, `${obs.sidecar?.state ?? 'no status'}, ${obs.sidecar?.messages ?? 0} messages`],
    ['ipc-native', (obs.ipcNative ?? 0) > 0, `${obs.ipcNative ?? 0} calls over the custom protocol`],
    ['screens-walked', (obs.walked ?? []).length >= 5, (obs.walked ?? []).join(', ')],
    ['capability-narrow', obs.capability?.windowDenied === true && obs.capability?.openerDenied === true, ''],
    ['inline-script-blocked', blocked(p.inlineScript, 'script-src-elem', obs), ''],
    ['eval-blocked', blocked(p.evalCall, 'script-src', obs), ''],
    ['foreign-fetch-blocked', blocked(p.foreignFetch, 'connect-src', obs) && p.foreignFetch?.hits === 0, `${p.foreignFetch?.hits ?? 'no'} arrived`],
    ['sibling-project-blocked', p.siblingProject?.attempted === true && p.siblingProject.effect === false && p.siblingProject.blockedByPolicy === true, ''],
    ['foreign-image-blocked', blocked(p.foreignImage, 'img-src', obs) && p.foreignImage?.hits === 0, `${p.foreignImage?.hits ?? 'no'} arrived`],
    ['inline-style-blocked', styleElement, ''],
    ['style-attribute-blocked', styleAttribute, ''],
    ['cssom-style-works', p.cssomStyle?.attempted === true && p.cssomStyle.effect === true, 'the way React writes a style prop'],
    ['base-uri-blocked', blocked(p.baseUri, 'base-uri', obs), ''],
    ['object-blocked', blocked(p.objectEmbed, 'object-src', obs) && p.objectEmbed?.hits === 0, ''],
    ['form-action-blocked', blocked(p.formAction, 'form-action', obs) && p.formAction?.hits === 0, ''],
  ];
};

const LOGIN = (obs) => [
  [
    'supabase-reached',
    obs.signIn?.attempted === true && obs.signIn?.status === 400 && obs.signIn?.host === obs.signIn?.policyHost &&
      obs.signIn?.path === '/auth/v1/token' && typeof obs.signIn?.shownError === 'string' && obs.signIn.shownError !== '',
    `${obs.signIn?.status ?? 'no response'}`,
  ],
  ['exactly-one-request', obs.signIn?.attempted === true && obs.signIn?.requests === 1, `${obs.signIn?.requests ?? 0} sign-in, ${obs.signIn?.preflights ?? 0} preflight`],
];

/** @returns {{ pass: boolean, checks: { id: string, ok: boolean, detail: string }[] }} */
export function judge(obs, variant) {
  const rows = [...COMMON(obs, variant), ...(variant.profile === 'login' ? LOGIN(obs) : SHELL(obs, variant))];
  const checks = rows.map(([id, ok, detail]) => ({ id, ok: ok === true, detail }));
  return { pass: checks.every((check) => check.ok), checks };
}

/**
 * A variant is proved when it did what it was built to do: pass, or fail at the check it names.
 *
 * A control must ALSO still pass everything its removal should leave alone. Without that, a window that
 * never loaded fails the named check for the wrong reason and counts as a proof, which is exactly what a
 * blank about:blank run did here before this line existed.
 */
export function outcome(variant, verdict) {
  if (variant.expect === 'pass') return verdict.pass;
  const named = verdict.checks.find((check) => check.id === variant.mustFailAt);
  const untouched = variant.mustStillPass ?? [];
  const leftAlone = untouched.length > 0 &&
    untouched.every((id) => verdict.checks.some((check) => check.id === id && check.ok));
  return verdict.pass === false && named !== undefined && named.ok === false && leftAlone;
}
