/**
 * A PHASE'S VALIDATORS JUDGE IT FROM THE APPROVED COMMIT — PROJECTOS-FINISH-WRITEPATHS1A.
 *
 * Against a REAL repository: the validator, its helper, its JSON data and a child script it spawns are
 * committed at the base, then a "worker" rewrites every one of them to pass while breaking the subject
 * they judge. Run unpinned, the tampered check passes — so the tamper is real. Run as the loop runs it,
 * from the base commit, it still fails — so the worker could not change what judged it. And the pinned
 * validator still reads the WORKER's tree: fixing the subject makes it pass.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeSystem, type System } from '../src/system.js';
import { pinValidators, releasePin, withPinnedValidators, type ValidatorPin } from '../src/loop/pinnedValidators.js';
import { checksFor, runChecks, VALIDATOR_RUNNER } from '../src/loop/verification.js';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function put(root: string, rel: string, text: string): void {
  mkdirSync(join(root, ...rel.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(root, ...rel.split('/')), text);
}

/** The committed validator: passes exactly when src/subject.txt holds the expected word and its child passes. */
const BASE: Record<string, string> = {
  'projectos/validators/val-subject.cjs': [
    '"use strict";',
    'const fs = require("fs");',
    'const path = require("path");',
    'const { spawnSync } = require("child_process");',
    'const rule = require("./lib/rule.cjs");',
    'const data = require("./lib/data.json");',
    'const ROOT = path.resolve(__dirname, "..", "..");',
    'const subject = fs.readFileSync(path.join(ROOT, "src", "subject.txt"), "utf8").trim();',
    'const child = spawnSync(process.execPath, [path.join(__dirname, "lib", "child.cjs")], { encoding: "utf8" });',
    'if (!rule(subject, data.expected) || child.status !== 0) { console.log("val-subject: FAIL"); process.exit(1); }',
    'console.log("val-subject: PASS");',
  ].join('\n'),
  'projectos/validators/lib/rule.cjs': 'module.exports = (subject, expected) => subject === expected;\n',
  'projectos/validators/lib/data.json': '{ "expected": "ok" }\n',
  // The child judges a file of its own, so a broken src/child.txt is caught by the child alone.
  'projectos/validators/lib/child.cjs': [
    'const fs = require("fs");',
    'const path = require("path");',
    'const s = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "src", "child.txt"), "utf8").trim();',
    'process.exit(s === "ok" ? 0 : 1);',
  ].join('\n'),
  'src/subject.txt': 'ok\n',
  'src/child.txt': 'ok\n',
};

/** Every file the worker rewrites to pass, whatever the subject says. */
const TAMPERED: Record<string, string> = {
  'projectos/validators/val-subject.cjs': 'console.log("val-subject: PASS");\n',
  'projectos/validators/lib/rule.cjs': 'module.exports = () => true;\n',
  'projectos/validators/lib/data.json': '{ "expected": "bad" }\n',
  'projectos/validators/lib/child.cjs': 'process.exit(0);\n',
};

function repository(): { root: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), 'projectos-pinned-repo-'));
  made.push(root);
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'fixture@projectos.invalid');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'core.autocrlf', 'false');
  for (const [rel, text] of Object.entries(BASE)) put(root, rel, text);
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'base');
  return { root, base: git(root, 'rev-parse', 'HEAD').trim() };
}

function judge(root: string, base: string, names: readonly string[] = ['val-subject']) {
  return withPinnedValidators(nodeSystem, root, base, (pin) => runChecks(nodeSystem, root, checksFor(nodeSystem, root, names, [], pin)));
}

describe('validators run from the base commit, whatever the worker wrote', () => {
  it('the base validator passes the untouched subject', () => {
    const { root, base } = repository();
    expect(judge(root, base)[0]?.passed).toBe(true);
  });

  it('a worker edit to the validator, its helper, its data and its child does NOT change the check result', () => {
    const { root, base } = repository();
    put(root, 'src/subject.txt', 'bad\n');
    put(root, 'src/child.txt', 'bad\n');
    for (const [rel, text] of Object.entries(TAMPERED)) put(root, rel, text);

    // The tamper is real: run the way checks ran before this phase, the broken subject passes.
    const unpinned = spawnSync(VALIDATOR_RUNNER, [join(root, 'projectos', 'validators', 'val-subject.cjs')], { cwd: root, encoding: 'utf8' });
    expect(unpinned.status).toBe(0);

    // Judged from the base commit, it fails — the worker could not change what judged it.
    const [result] = judge(root, base);
    expect(result?.passed).toBe(false);
    expect(result?.output).toContain('val-subject: FAIL');
  });

  it('the child a pinned validator spawns is pinned too', () => {
    const { root, base } = repository();
    // The main rule is satisfied; only the child's file is broken, and only the child is tampered. An
    // UNPINNED child would exit 0 and the check would pass.
    put(root, 'src/child.txt', 'bad\n');
    put(root, 'projectos/validators/lib/child.cjs', TAMPERED['projectos/validators/lib/child.cjs'] as string);
    const unpinnedChild = spawnSync(VALIDATOR_RUNNER, [join(root, 'projectos', 'validators', 'lib', 'child.cjs')], { cwd: root });
    expect(unpinnedChild.status).toBe(0);
    expect(judge(root, base)[0]?.passed).toBe(false);
  });

  it("the pinned validator still judges the WORKER's tree: a fixed subject passes under tampered code", () => {
    const { root, base } = repository();
    for (const [rel, text] of Object.entries(TAMPERED)) put(root, rel, text);
    put(root, 'src/subject.txt', 'ok\n');
    expect(judge(root, base)[0]?.passed).toBe(true);
  });

  it('a validator the worker ADDED cannot judge the phase', () => {
    const { root, base } = repository();
    put(root, 'projectos/validators/val-new.cjs', 'console.log("ok");\n');
    const [result] = judge(root, base, ['val-new']);
    expect(result?.passed).toBe(false);
    expect(result?.output).toContain("not in the phase's base commit");
  });

  it('a helper the worker deleted fails the check rather than loading anything else', () => {
    const { root, base } = repository();
    rmSync(join(root, 'projectos', 'validators', 'lib', 'rule.cjs'));
    expect(judge(root, base)[0]?.passed).toBe(false);
  });

  it('a base commit that is not a full id, or that git does not know, leaves the validator unrunnable', () => {
    const { root } = repository();
    for (const commit of ['HEAD', 'f'.repeat(40)]) {
      const [result] = judge(root, commit);
      expect(result?.passed, commit).toBe(false);
      expect(result?.output, commit).toContain("cannot be run from the phase's base commit");
    }
  });

  /**
   * ECC SECURITY H1 / ECC CODE M1: Node resolves a module's filename through junctions and links, so a
   * root reached through one never matched a plain prefix and the loader fell through to the working
   * tree's copy — silently. It must still pin, and a validator it cannot place must refuse, never pass.
   */
  it('a governed root reached through a JUNCTION still judges from the base commit', () => {
    const { root, base } = repository();
    const holder = mkdtempSync(join(tmpdir(), 'projectos-pinned-link-'));
    made.push(holder);
    const linked = join(holder, 'checkout');
    symlinkSync(root, linked, 'junction');
    put(root, 'src/subject.txt', 'bad\n');
    put(root, 'src/child.txt', 'bad\n');
    for (const [rel, text] of Object.entries(TAMPERED)) put(root, rel, text);
    const [result] = judge(linked, base);
    expect(result?.passed).toBe(false);
    expect(result?.output).toContain('val-subject: FAIL');
    put(root, 'src/subject.txt', 'ok\n');
    put(root, 'src/child.txt', 'ok\n');
    expect(judge(linked, base)[0]?.passed).toBe(true);
  });

  it('a pin whose blob git cannot show fails, and leaves no directory behind', () => {
    const { root, base } = repository();
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith('projectos-pinned-')).length;
    const failingShow: System = {
      ...nodeSystem,
      exec: (cmd, args, options) =>
        args.includes('show') ? { code: 128, stdout: '', stderr: 'fatal' } : nodeSystem.exec(cmd, args, options),
    };
    const pin = pinValidators(failingShow, root, base);
    expect(pin.ok).toBe(false);
    if (!pin.ok) expect(pin.problem).toContain('git could not show');
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith('projectos-pinned-')).length).toBe(before);
  });

  it('withPinnedValidators removes the pin even when the work it wraps throws', () => {
    const { root, base } = repository();
    let dir = '';
    expect(() =>
      withPinnedValidators(nodeSystem, root, base, (pin) => {
        if (pin.ok) dir = pin.dir;
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(dir).not.toBe('');
    expect(existsSync(dir)).toBe(false);
  });

  it('the pinned copy lives outside the checkout and is removed afterwards', () => {
    const { root, base } = repository();
    const pin: ValidatorPin = pinValidators(nodeSystem, root, base);
    expect(pin.ok).toBe(true);
    if (!pin.ok) return;
    expect(pin.dir.startsWith(root)).toBe(false);
    expect(pin.files.has('projectos/validators/val-subject.cjs')).toBe(true);
    expect(pin.files.has('projectos/validators/lib/data.json')).toBe(true);
    releasePin(pin);
    expect(existsSync(pin.dir)).toBe(false);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });
});
