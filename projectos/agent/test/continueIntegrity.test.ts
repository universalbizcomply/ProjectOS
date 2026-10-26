/**
 * A PHASE CANNOT GRADE ITS OWN NEW CHECK WITH THE OLD ONE — PROJECTOS-FINISH-CONTINUE-INTEGRITY1A (D8).
 *
 * `phaseCopyChecks` adds the phase's own copy of a required validator its write paths cover. These prove the
 * selection directly; `continuationEndToEnd.test.ts` proves it through the run and closure preparation.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeSystem, type System } from '../src/system.js';
import { execFileSync } from 'node:child_process';
import { PHASE_COPY_PICTURE_MAX_BYTES, PHASE_COPY_SUFFIX, PHASE_COPY_TIMEOUT_MS, VALIDATOR_RUNNER, phaseCopyChecks, runPhaseCopyChecks } from '../src/loop/verification.js';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function root(): string {
  const r = mkdtempSync(join(tmpdir(), 'projectos-phase-copy-'));
  made.push(r);
  mkdirSync(join(r, 'projectos', 'validators'), { recursive: true });
  writeFileSync(join(r, 'projectos', 'validators', 'validate-site.cjs'), 'console.log("ok");\n');
  return r;
}

describe('the phase copy of a required validator', () => {
  it('is added for a required validator the write paths name exactly, run from the subject without the pin', () => {
    const r = root();
    const specs = phaseCopyChecks(nodeSystem, r, ['validate-site'], ['projectos/validators/validate-site.cjs']);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.id).toBe(`validate-site${PHASE_COPY_SUFFIX}`);
    expect(specs[0]?.args).toHaveLength(1);
    expect(String(specs[0]?.args[0]).replace(/\\/g, '/')).toMatch(/\/projectos\/validators\/validate-site\.cjs$/);
    expect(specs[0]?.args).not.toContain('--require');
    expect(specs[0]?.unrunnable).toBeNull();
    // The pinned node runner, never a bare name a committed binary could answer to; and a short bound.
    expect(specs[0]?.command).toBe(VALIDATOR_RUNNER);
    expect(specs[0]?.timeoutMs).toBe(PHASE_COPY_TIMEOUT_MS);
  });

  it('is added for a ./-prefixed path, and only for an exact file entry (the grant refuses a validator directory)', () => {
    const r = root();
    expect(phaseCopyChecks(nodeSystem, r, ['validate-site'], ['./projectos/validators/validate-site.cjs'])).toHaveLength(1);
    expect(phaseCopyChecks(nodeSystem, r, ['validate-site'], ['projectos/validators/'])).toEqual([]);
  });

  it('is NOT added when the write paths do not cover the validator, or the validator is not required', () => {
    const r = root();
    expect(phaseCopyChecks(nodeSystem, r, ['validate-site'], ['./site/index.html', 'projectos/validators/other.cjs'])).toEqual([]);
    expect(phaseCopyChecks(nodeSystem, r, ['validate-all'], ['projectos/validators/validate-site.cjs'])).toEqual([]);
    expect(phaseCopyChecks(nodeSystem, r, ['validate-site'], ['projectos/validators-extra/'])).toEqual([]);
  });

  it('never turns an unsafe validator name into a path', () => {
    const r = root();
    expect(phaseCopyChecks(nodeSystem, r, ['../validate-site', 'a/b'], ['projectos/'])).toEqual([]);
  });

  it('a covered validator whose phase copy is missing is unrunnable, so it fails rather than being skipped', () => {
    const r = root();
    const specs = phaseCopyChecks(nodeSystem, r, ['validate-gone'], ['projectos/validators/validate-gone.cjs']);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.unrunnable).toContain("phase's own copy");
  });

  it('a phase copy that changes the checkout while it runs FAILS, even when it exits 0 (ECC SECURITY)', () => {
    const r = root();
    execFileSync('git', ['-C', r, 'init', '--quiet']);
    writeFileSync(join(r, 'projectos', 'validators', 'validate-site.cjs'), "require('fs').writeFileSync(require('path').join(__dirname, 'left-behind.txt'), 'x'); console.log('ok');\n");
    const [result] = runPhaseCopyChecks(nodeSystem, r, phaseCopyChecks(nodeSystem, r, ['validate-site'], ['projectos/validators/validate-site.cjs']));
    expect(result?.exitCode).toBe(0);
    expect(result?.passed).toBe(false);
    expect(result?.output).toContain('changed the checkout');
  });

  it('a phase copy that leaves the checkout as it found it passes on its own exit code', () => {
    const r = root();
    execFileSync('git', ['-C', r, 'init', '--quiet']);
    const [result] = runPhaseCopyChecks(nodeSystem, r, phaseCopyChecks(nodeSystem, r, ['validate-site'], ['projectos/validators/validate-site.cjs']));
    expect(result?.passed).toBe(true);
  });

  it('reads the checkout picture with a buffer large enough for a real checkout, so a big tree is not read as unanswerable (ECC SECURITY round 2)', () => {
    const r = root();
    execFileSync('git', ['-C', r, 'init', '--quiet']);
    const seen: (number | undefined)[] = [];
    const sys: System = { ...nodeSystem, exec: (cmd, args, options) => { if (args.includes('status')) seen.push(options?.maxOutputBytes); return nodeSystem.exec(cmd, args, options); } };
    runPhaseCopyChecks(sys, r, phaseCopyChecks(sys, r, ['validate-site'], ['projectos/validators/validate-site.cjs']));
    expect(seen).toEqual([PHASE_COPY_PICTURE_MAX_BYTES, PHASE_COPY_PICTURE_MAX_BYTES]);
    expect(PHASE_COPY_PICTURE_MAX_BYTES).toBeGreaterThanOrEqual(64 * 1024 * 1024);
  });
});
