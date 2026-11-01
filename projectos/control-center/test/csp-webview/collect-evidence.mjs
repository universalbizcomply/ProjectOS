#!/usr/bin/env node
/**
 * Fold the per-variant run files into the committed evidence — PROJECTOS-TENANT-CSP1A.
 *
 *   node test/csp-webview/collect-evidence.mjs <runs-dir> <evidence-file>
 *
 * It copies named fields and nothing else, so console text and page state stay out of the record. The
 * hashes bind the evidence to the policy and capability it ran under: change either and
 * val-projectos-tenant-csp1a calls the evidence stale.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONTROL_CENTER, committedDevPolicy, committedPolicy, variants } from './variants.mjs';
import { outcome } from './verdict.mjs';

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function summarise(run) {
  const { obs, verdict } = run;
  const variant = variants()[run.variant];
  const passed = verdict.checks.filter((check) => check.ok).map((check) => check.id);
  const failed = verdict.checks.filter((check) => !check.ok).map((check) => check.id);
  return {
    variant: run.variant,
    expect: variant.expect,
    mustFailAt: variant.mustFailAt ?? null,
    proved: outcome(variant, verdict),
    browser: obs.browser ?? null,
    passed,
    failed,
    scriptHashesServed: (String(obs.servedPolicy).match(/'sha256-/g) ?? []).length,
    elements: obs.loaded?.elements ?? 0,
    sidecar: obs.sidecar === undefined ? null : { state: obs.sidecar.state, messages: obs.sidecar.messages, kinds: obs.sidecar.kinds ?? {} },
    walked: obs.walked ?? null,
    fonts: obs.fonts === undefined ? null : {
      bundledLoaded: obs.fonts.bundledLoaded === true,
      widthDiffers: obs.fonts.widthDiffers === true,
      fetched: (obs.fonts.requested ?? []).map((font) => font.name),
    },
    ipcNative: obs.ipcNative ?? 0,
    abortedByReload: obs.abortedByReload ?? 0,
    violationsInUse: (obs.violations ?? []).length,
    consoleRefusalsInUse: (obs.consoleViolations ?? []).length,
    blockedDirectives: [...new Set((obs.probeViolations ?? []).map((v) => v.directive))].sort(),
    arrivedAtListener: obs.listenerHits ?? null,
    capability: obs.capability ?? null,
    signIn: obs.signIn === undefined ? null : {
      attempted: obs.signIn.attempted,
      method: obs.signIn.method,
      host: obs.signIn.host,
      path: obs.signIn.path,
      query: obs.signIn.query,
      status: obs.signIn.status,
      shownError: obs.signIn.shownError ?? null,
      requests: obs.signIn.requests,
      preflights: obs.signIn.preflights,
      blockedByPolicy: obs.signIn.blockedByPolicy,
      otherOnHost: obs.signIn.otherOnHost,
    },
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]).endsWith('collect-evidence.mjs')) {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) {
    console.error('usage: collect-evidence.mjs <runs-dir> <evidence-file>');
    process.exit(2);
  }
  const capability = readFileSync(join(CONTROL_CENTER, 'src-tauri', 'capabilities', 'default.json'), 'utf8');
  const runs = Object.keys(variants()).map((name) => summarise(JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'))));
  writeFileSync(out, `${JSON.stringify({
    phase: 'PROJECTOS-TENANT-CSP1A',
    policySha256: sha256(committedPolicy()),
    devPolicySha256: sha256(committedDevPolicy()),
    capabilityPermissionsSha256: sha256(JSON.stringify(JSON.parse(capability).permissions)),
    runs,
  }, null, 2)}\n`);
  console.log(`[csp-proof] ${runs.length} runs, ${runs.filter((run) => run.proved).length} proved`);
}
