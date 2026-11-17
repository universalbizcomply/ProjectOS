/**
 * The scratch checkout against REAL directories and REAL git. PROJECTOS-WORKER-SCRATCH-CHECKOUT1A (plan 4.3a).
 *
 * Every test builds a throwaway repository in the temp directory, exports a scratch of it, lets "the worker" act in the
 * scratch with plain file operations, and then judges and copies back. No worker, no provider, no network.
 * The Codex adapter's own tests (fake spawn) are in `codexImplementerAdapter.test.ts`; the adapter with the real scratch
 * is in `codexImplementerScratch.test.ts`.
 *
 * Each test says which rule of the delta spec it proves ("rule N").
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeSystem } from '../src/system.js';
import type { ExecResult, System } from '../src/system.js';
import {
  copyBack,
  destinationProblem,
  judgeChanges,
  nodeScratchFs,
  nodeScratchHost,
  plainName,
  safeRelativePath,
  scratchHostWith,
  type Manifest,
  type ScratchCheckout,
  type ScratchFs,
} from '../src/loop/scratchCheckout.js';

let base = '';
let real = '';
const opened: ScratchCheckout[] = [];
const git = (...args: string[]) => execFileSync('git', ['-C', real, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (dir: string, rel: string, content: string | Buffer) => {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
};
const GRANTS = ['src/feature.ts', 'docs', '.projectops/execution/*.findings.json', '.projectops/execution/*.effects.json'];
const BINARY = Buffer.from(Array.from({ length: 256 }, (_v, i) => i));

/** Every file and directory below `dir` (never `.git`), by content hash. A link is recorded as a link, never followed. */
function treeOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      if (rel === '' && name === '.git') continue;
      const abs = join(d, name);
      const key = rel === '' ? name : `${rel}/${name}`;
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) out[key] = 'link';
      else if (st.isDirectory()) {
        out[key] = 'dir';
        walk(abs, key);
      } else out[key] = createHash('sha256').update(readFileSync(abs)).digest('hex');
    }
  };
  walk(dir, '');
  return out;
}

function openScratch(host = nodeScratchHost, sys: System = nodeSystem): ScratchCheckout {
  const r = host.open(sys, real);
  if (!r.ok) throw new Error(`could not open: ${r.reason}`);
  opened.push(r.scratch);
  return r.scratch;
}

/** Open, baseline, let the worker act, judge. */
function inspectAfter(act: (root: string) => void, scopes: readonly string[] = GRANTS) {
  const scratch = openScratch();
  expect(scratch.baseline()).toBeNull();
  act(scratch.root);
  return { scratch, inspected: scratch.inspect(scopes) };
}

const refusedPaths = (i: { kind: string; refusals?: readonly { path: string }[] }) => (i.kind === 'refused' ? (i.refusals ?? []).map((r) => r.path) : []);

/** A directory junction needs no privilege on Windows; a file symlink may not be allowed. */
function junction(target: string, link: string) {
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, 'junction');
}
const canSymlinkFiles = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'projectos-symprobe-'));
  try {
    writeFileSync(join(probe, 'a'), 'x');
    symlinkSync(join(probe, 'a'), join(probe, 'b'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'projectos-scratchtest-'));
  real = join(base, 'repo');
  mkdirSync(real);
  execFileSync('git', ['init', '-q', real]);
  git('config', 'user.email', 'test@projectos.invalid');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
  put(real, '.gitignore', 'node_modules/\n.env\n.projectops/execution/\n');
  put(real, 'src/feature.ts', 'one\n');
  put(real, 'src/other.ts', 'one\n');
  put(real, 'src/my file é.ts', 'unicode name\n');
  put(real, 'docs/plain.md', 'one\n');
  put(real, 'docs/sub/deep.md', 'one\n');
  put(real, 'docs/gone.md', 'will be deleted from the working tree\n');
  put(real, 'assets/logo.bin', BINARY);
  put(real, '.projectops/project-config.json', '{"tracked":true}\n');
  put(real, 'CLAUDE.md', 'instructions\n');
  put(real, 'AGENTS.md', 'instructions\n');
  put(real, '.claude/settings.json', '{}\n');
  put(real, '.github/workflows/ci.yml', 'on: push\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  rmSync(join(real, 'docs/gone.md'));
  put(real, 'src/untracked.ts', 'untracked, not ignored\n');
  put(real, '.env', 'SECRET=1\n');
  put(real, 'node_modules/pkg/index.js', 'module.exports = 1;\n');
  put(real, '.projectops/execution/s1.evidence.json', '{"evidence":true}\n');
  put(real, '.projectops/execution/s1.findings.json', '{"findings":[]}\n');
});

afterEach(() => {
  for (const s of opened.splice(0)) s.dispose();
  rmSync(base, { recursive: true, force: true });
});

describe('PROJECTOS-WORKER-SCRATCH-CHECKOUT1A: the scratch export', () => {
  it('rule 1: holds the tracked and untracked files byte for byte, and never .git, an ignored file or an agent control path', () => {
    const scratch = openScratch();
    const tree = treeOf(scratch.root);
    expect(Object.keys(tree)).toEqual(expect.arrayContaining(['src/feature.ts', 'src/other.ts', 'src/my file é.ts', 'docs/plain.md', 'docs/sub/deep.md', 'src/untracked.ts', 'assets/logo.bin', '.projectops/project-config.json']));
    expect(readFileSync(join(scratch.root, 'assets/logo.bin')).equals(BINARY)).toBe(true);
    expect(readFileSync(join(scratch.root, 'src/my file é.ts'), 'utf8')).toBe('unicode name\n');
    for (const absent of ['.env', 'node_modules', '.gitignore', 'CLAUDE.md', 'AGENTS.md', '.claude', '.github', 'docs/gone.md', '.projectops/execution']) {
      expect(Object.keys(tree), absent).not.toContain(absent);
    }
    // nothing of the real `.git` came across: the one `.git` there is the scratch's own
    expect(readdirSync(scratch.root).includes('.git')).toBe(true);
  });

  it('rule 1: a tracked file that is gone from the working tree is skipped, and an unsafe path from git refuses the export', () => {
    expect(existsSync(join(openScratch().root, 'docs/gone.md'))).toBe(false);
    for (const unsafe of ['../outside.txt', 'a:stream.txt', 'C:/x.txt', '/abs.txt', 'dir\\file.txt', 'trailing.', 'a//b.txt']) {
      const lying: System = { ...nodeSystem, exec: (cmd, args, options): ExecResult => (args.includes('ls-files') && args.includes('--others') ? { code: 0, stdout: `src/feature.ts\0${unsafe}\0`, stderr: '' } : nodeSystem.exec(cmd, args, options)) };
      const r = nodeScratchHost.open(lying, real);
      expect(r.ok, unsafe).toBe(false);
      if (r.ok) r.scratch.dispose();
    }
  });

  it('rule 2: is a standalone repository with no remote and no link to the real .git', () => {
    git('remote', 'add', 'origin', 'https://example.invalid/real.git');
    const scratch = openScratch();
    const inScratch = (...args: string[]) => execFileSync('git', ['-C', scratch.root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    expect(inScratch('rev-parse', '--git-dir')).toBe('.git');
    expect(inScratch('rev-parse', '--git-common-dir')).toBe('.git');
    expect(inScratch('remote')).toBe('');
    expect(readFileSync(join(scratch.root, '.git/config'), 'utf8')).not.toMatch(/url\s*=|real\.git|[\\/]repo/);
    expect(existsSync(join(scratch.root, '.git/objects/info/alternates'))).toBe(false);
    expect(inScratch('status', '--porcelain').length).toBeGreaterThan(0);
    expect(() => inScratch('rev-parse', 'HEAD')).toThrow();
  });

  it('refuses to export when the scratch would lie inside the checkout, or the checkout is over the bound, or is not there', () => {
    const inside: ScratchFs = { ...nodeScratchFs, makeTempDir: (prefix) => { const d = join(real, `${prefix}x`); mkdirSync(d); return d; } };
    expect(scratchHostWith(inside).open(nodeSystem, real).ok).toBe(false);
    expect(existsSync(join(real, 'projectos-scratch-x'))).toBe(false);
    const small = scratchHostWith(nodeScratchFs, { maxFiles: 3, maxBytes: 1 << 30, maxEntries: 1000, maxPlacedBytes: 1 << 20 });
    expect(small.open(nodeSystem, real).ok).toBe(false);
    const tiny = scratchHostWith(nodeScratchFs, { maxFiles: 1000, maxBytes: 10, maxEntries: 1000, maxPlacedBytes: 1 << 20 });
    expect(tiny.open(nodeSystem, real).ok).toBe(false);
    expect(scratchHostWith(nodeScratchFs).open(nodeSystem, join(base, 'no-such-dir')).ok).toBe(false);
  });
});

describe('what the worker changed is judged before anything is written', () => {
  it('rule 3: a changed file outside the grants refuses the whole copy-back, and nothing is written to the real tree', () => {
    const before = treeOf(real);
    const { scratch, inspected } = inspectAfter((root) => {
      put(root, 'src/feature.ts', 'two\n'); // granted
      put(root, 'docs/new.md', 'granted and new\n'); // granted
      put(root, 'src/other.ts', 'two\n'); // NOT granted
      put(root, 'validators/x.cjs', 'x\n'); // NOT granted and new
    });
    expect(inspected.kind).toBe('refused');
    expect(refusedPaths(inspected)).toEqual(['src/other.ts', 'validators/x.cjs']);
    expect(scratch.copyBack().kind).toBe('refused');
    expect(treeOf(real)).toEqual(before);
  });

  it('rule 3: a change is found by content, not size or time: the same bytes count, the same length with other bytes does not', () => {
    const same = inspectAfter((root) => put(root, 'src/other.ts', 'one\n'));
    expect(same.inspected).toMatchObject({ kind: 'clean', writes: 0 });
    const other = inspectAfter((root) => put(root, 'src/other.ts', 'two\n'));
    expect(refusedPaths(other.inspected)).toEqual(['src/other.ts']);
  });

  it.each([
    ['docs/.claude/settings.json'],
    ['docs/.codex/config.toml'],
    ['docs/.agents/skill.md'],
    ['docs/AGENTS.md'],
    ['docs/CLAUDE.md'],
    ['docs/.gitattributes'],
    ['docs/.git/config'],
  ])('rule 4: %s is refused even though the directory docs is granted', (rel) => {
    const { inspected } = inspectAfter((root) => {
      put(root, rel, 'x\n');
      put(root, 'docs/ok.md', 'fine\n');
    });
    expect(inspected.kind).toBe('refused');
    expect(refusedPaths(inspected)).toEqual([rel]);
  });

  it('rule 5: a new junction anywhere in the scratch refuses, and is never followed', () => {
    const outside = join(base, 'elsewhere');
    put(outside, 'secret.txt', 'outside\n');
    const { scratch, inspected } = inspectAfter((root) => junction(outside, join(root, 'docs/lnk')));
    expect(inspected.kind).toBe('refused');
    expect(refusedPaths(inspected)).toEqual(['docs/lnk']);
    expect(scratch.copyBack().kind).toBe('refused');
    expect(existsSync(join(real, 'docs/lnk'))).toBe(false);
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('outside\n');
  });

  it.skipIf(!canSymlinkFiles)('rule 5: a file replaced by a symlink refuses', () => {
    const { inspected } = inspectAfter((root) => {
      rmSync(join(root, 'docs/plain.md'));
      symlinkSync(join(root, 'docs/sub/deep.md'), join(root, 'docs/plain.md'), 'file');
    });
    expect(inspected.kind).toBe('refused');
    expect(refusedPaths(inspected)).toContain('docs/plain.md');
  });

  it('rule 5: a junction that points at the real checkout is neither followed nor written through', () => {
    const before = treeOf(real);
    const { inspected } = inspectAfter((root) => {
      junction(join(real, 'src'), join(root, 'docs/real-src'));
      // a write through the junction lands in the REAL tree: that is the adapter's real-root snapshot to catch, not this judgement
    });
    expect(inspected.kind).toBe('refused');
    expect(refusedPaths(inspected)).toEqual(['docs/real-src']);
    expect(treeOf(real)).toEqual(before);
  });

  it('rule 6: a file that became a directory, and a directory that became a file, refuse', () => {
    const a = inspectAfter((root) => {
      rmSync(join(root, 'docs/plain.md'));
      put(root, 'docs/plain.md/inner.md', 'x\n');
    });
    expect(a.inspected.kind).toBe('refused');
    expect(refusedPaths(a.inspected)).toContain('docs/plain.md');
    const b = inspectAfter((root) => {
      rmSync(join(root, 'docs/sub'), { recursive: true });
      put(root, 'docs/sub', 'now a file\n');
    });
    expect(b.inspected.kind).toBe('refused');
    expect(refusedPaths(b.inspected)).toContain('docs/sub');
  });

  it('rule 7: a real destination that passes through a link refuses, and nothing is written through it', () => {
    const outside = join(base, 'elsewhere');
    put(outside, 'deep.md', 'outside original\n');
    const scratch = openScratch();
    expect(scratch.baseline()).toBeNull();
    put(scratch.root, 'docs/sub/deep.md', 'changed in the scratch\n');
    rmSync(join(real, 'docs/sub'), { recursive: true });
    junction(outside, join(real, 'docs/sub')); // the real tree changed after the export
    const inspected = scratch.inspect(GRANTS);
    expect(inspected.kind).toBe('refused');
    expect(refusedPaths(inspected)).toEqual(['docs/sub/deep.md']);
    expect(scratch.copyBack().kind).toBe('refused');
    expect(readFileSync(join(outside, 'deep.md'), 'utf8')).toBe('outside original\n');
  });

  it('rule 7: a real destination that is a directory where a file is expected refuses', () => {
    const scratch = openScratch();
    expect(scratch.baseline()).toBeNull();
    put(scratch.root, 'docs/plain.md', 'changed\n');
    rmSync(join(real, 'docs/plain.md'));
    mkdirSync(join(real, 'docs/plain.md'));
    expect(refusedPaths(scratch.inspect(GRANTS))).toEqual(['docs/plain.md']);
  });

  it('rule 8: deleting a granted file refuses, even when the file is granted by name or by directory', () => {
    const byName = inspectAfter((root) => rmSync(join(root, 'src/feature.ts')));
    expect(refusedPaths(byName.inspected)).toEqual(['src/feature.ts']);
    const byDirectory = inspectAfter((root) => rmSync(join(root, 'docs/plain.md')));
    expect(refusedPaths(byDirectory.inspected)).toEqual(['docs/plain.md']);
    expect(existsSync(join(real, 'docs/plain.md'))).toBe(true);
  });

  it('rule 9: a write made and undone leaves no trace, and nothing is copied', () => {
    const before = treeOf(real);
    const { scratch, inspected } = inspectAfter((root) => {
      put(root, 'src/feature.ts', 'temporarily different\n');
      put(root, 'src/feature.ts', 'one\n');
      put(root, 'validators/scratch.cjs', 'x\n');
      rmSync(join(root, 'validators'), { recursive: true });
      put(root, 'docs/tmp/a.md', 'x\n');
      rmSync(join(root, 'docs/tmp'), { recursive: true });
    });
    expect(inspected).toMatchObject({ kind: 'clean', writes: 0 });
    expect(scratch.copyBack()).toMatchObject({ kind: 'copied', paths: [] });
    expect(treeOf(real)).toEqual(before);
  });

  it('rule 10: a refused run leaves the real tree byte-identical, however much of it was acceptable', () => {
    const before = treeOf(real);
    const { scratch, inspected } = inspectAfter((root) => {
      put(root, 'src/feature.ts', 'good change\n');
      put(root, 'docs/a/b/c.md', 'good new file in new directories\n');
      put(root, '.claude/settings.json', '{"hooks":"evil"}\n');
    });
    expect(inspected.kind).toBe('refused');
    expect(scratch.copyBack().kind).toBe('refused');
    expect(treeOf(real)).toEqual(before);
  });

  it('rule 11: the worker-owned records are copied back like any granted path; the placed brief, evidence and context are not', () => {
    const scratch = openScratch();
    expect(scratch.placeText(join(real, '.projectops/execution/s1.brief.json'), '{"brief":"scratch copy"}\n')).toBeNull();
    expect(scratch.placeFile(join(real, '.projectops/execution/s1.evidence.json'))).toBeNull();
    expect(scratch.placeFile(join(real, '.projectops/execution/s1.findings.json'))).toBeNull();
    expect(scratch.baseline()).toBeNull();
    put(scratch.root, '.projectops/execution/s1.findings.json', '{"findings":["new"]}\n');
    put(scratch.root, '.projectops/execution/s1.effects.json', '{"effects":true}\n');
    const inspected = scratch.inspect(GRANTS);
    expect(inspected).toMatchObject({ kind: 'clean', writes: 2 });
    expect(scratch.copyBack()).toMatchObject({ kind: 'copied', paths: ['.projectops/execution/s1.effects.json', '.projectops/execution/s1.findings.json'] });
    expect(readFileSync(join(real, '.projectops/execution/s1.findings.json'), 'utf8')).toBe('{"findings":["new"]}\n');
    expect(readFileSync(join(real, '.projectops/execution/s1.effects.json'), 'utf8')).toBe('{"effects":true}\n');
    expect(existsSync(join(real, '.projectops/execution/s1.brief.json'))).toBe(false);
    expect(readFileSync(join(real, '.projectops/execution/s1.evidence.json'), 'utf8')).toBe('{"evidence":true}\n');
  });

  it('rule 11: the loop-owned records placed in the scratch are not the worker\'s to change', () => {
    const scratch = openScratch();
    expect(scratch.placeFile(join(real, '.projectops/execution/s1.evidence.json'))).toBeNull();
    expect(scratch.baseline()).toBeNull();
    put(scratch.root, '.projectops/execution/s1.evidence.json', '{"evidence":"forged"}\n');
    expect(refusedPaths(scratch.inspect(GRANTS))).toEqual(['.projectops/execution/s1.evidence.json']);
    expect(readFileSync(join(real, '.projectops/execution/s1.evidence.json'), 'utf8')).toBe('{"evidence":true}\n');
  });

  it('places nothing from outside the checkout, nothing that is a link, and maps real paths into the scratch only', () => {
    const scratch = openScratch();
    const outside = join(base, 'elsewhere.json');
    writeFileSync(outside, '{}');
    expect(scratch.placeFile(outside)).not.toBeNull();
    expect(scratch.scratchPathOf(outside)).toBeNull();
    expect(scratch.scratchPathOf(join(real, '..', 'repo2', 'x'))).toBeNull();
    expect(scratch.scratchPathOf(join(real, 'src/feature.ts'))).toBe(join(scratch.root, 'src', 'feature.ts'));
    expect(scratch.scratchPathOf(real)).toBeNull();
    mkdirSync(join(base, 'elsewhere-dir'));
    junction(join(base, 'elsewhere-dir'), join(real, '.projectops/execution/linked'));
    expect(scratch.placeFile(join(real, '.projectops/execution/linked'))).not.toBeNull();
    expect(scratch.placeFile(join(real, '.projectops/execution/does-not-exist.json'))).not.toBeNull();
  });

  it('never trusts a path from the scratch: an unsafe or escaping name is refused whatever the grants say', () => {
    const none: Manifest = new Map();
    const hash = 'a'.repeat(64);
    for (const bad of ['../escape.txt', 'docs/../../escape.txt', '/abs/path.txt', 'C:/win.txt', 'docs/a:b.txt', 'docs/a.txt:stream', 'docs\\back.txt', 'docs/trailing.', 'docs//double.txt', 'docs/nul\u0000.txt']) {
      const after: Manifest = new Map([[bad, { kind: 'file', hash }]]);
      const j = judgeChanges(none, after, ['docs', '..', '.', 'src']);
      expect(j.writes, bad).toEqual([]);
      expect(j.refusals.map((r) => r.path), bad).toEqual([bad]);
    }
    expect(safeRelativePath('docs/ok file é.md')).toBe(true);
    expect(safeRelativePath('docs/.hidden')).toBe(true);
  });
});

describe('copy back', () => {
  it('copies new and changed files inside the grants, creating directories, byte for byte, and nothing else', () => {
    const before = treeOf(real);
    const { scratch, inspected } = inspectAfter((root) => {
      put(root, 'src/feature.ts', 'two\n');
      put(root, 'docs/a/b/new.md', 'new in new directories\n');
      put(root, 'docs/plain.md', BINARY);
    });
    expect(inspected).toMatchObject({ kind: 'clean', writes: 3 });
    const out = scratch.copyBack();
    expect(out).toMatchObject({ kind: 'copied' });
    const after = treeOf(real);
    expect(readFileSync(join(real, 'docs/plain.md')).equals(BINARY)).toBe(true);
    expect(readFileSync(join(real, 'docs/a/b/new.md'), 'utf8')).toBe('new in new directories\n');
    const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]).sort();
    expect(changed).toEqual(['docs/a', 'docs/a/b', 'docs/a/b/new.md', 'docs/plain.md', 'src/feature.ts']);
  });

  it('restores the real tree when a copy fails part-way, and says it did', () => {
    const before = treeOf(real);
    let copies = 0;
    const failing: ScratchFs = { ...nodeScratchFs, copyFile: (from, to) => { if (to.startsWith(real)) { copies += 1; if (copies === 3) throw Object.assign(new Error('disk gone'), { code: 'EIO' }); } nodeScratchFs.copyFile(from, to); } };
    const scratch = openScratch(scratchHostWith(failing));
    expect(scratch.baseline()).toBeNull();
    put(scratch.root, 'docs/a/new.md', 'new\n');
    put(scratch.root, 'docs/plain.md', 'changed\n');
    put(scratch.root, 'src/feature.ts', 'changed\n');
    expect(scratch.inspect(GRANTS)).toMatchObject({ kind: 'clean', writes: 3 });
    const out = scratch.copyBack();
    expect(out).toMatchObject({ kind: 'failed', rolledBack: true });
    if (out.kind === 'failed') expect(out.reason).toContain('EIO');
    expect(treeOf(real)).toEqual(before);
  });

  it('restores the real tree when the bytes written are not the bytes that were judged (a worker still writing)', () => {
    const before = treeOf(real);
    let late = false;
    const racing: ScratchFs = { ...nodeScratchFs, copyFile: (from, to) => { if (!late && to.startsWith(real)) { late = true; writeFileSync(from, 'changed after it was judged\n'); } nodeScratchFs.copyFile(from, to); } };
    const scratch = openScratch(scratchHostWith(racing));
    expect(scratch.baseline()).toBeNull();
    put(scratch.root, 'docs/plain.md', 'as judged\n');
    expect(scratch.inspect(GRANTS)).toMatchObject({ kind: 'clean', writes: 1 });
    const out = scratch.copyBack();
    expect(out).toMatchObject({ kind: 'failed', rolledBack: true });
    expect(treeOf(real)).toEqual(before);
  });
});

describe('rule 12: the scratch is removed on every path', () => {
  it('dispose removes the whole scratch, including a link the worker made, and leaves the link\'s target alone', () => {
    const outside = join(base, 'elsewhere');
    put(outside, 'keep.txt', 'keep\n');
    const scratch = openScratch();
    junction(outside, join(scratch.root, 'docs/lnk'));
    const holder = dirname(scratch.root);
    expect(existsSync(holder)).toBe(true);
    expect(scratch.dispose()).toBeNull();
    expect(existsSync(holder)).toBe(false);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep\n');
    expect(scratch.dispose()).toBeNull(); // again: nothing left, nothing to report
  });

  it('a failed cleanup is reported, never swallowed, and does not throw', () => {
    const stuck: ScratchFs = { ...nodeScratchFs, removeTree: () => { throw Object.assign(new Error('in use'), { code: 'EBUSY' }); } };
    const scratch = openScratch(scratchHostWith(stuck));
    const holder = dirname(scratch.root);
    const problem = scratch.dispose();
    expect(problem).toContain('EBUSY');
    nodeScratchFs.removeTree(holder);
  });

  it('a refused export leaves no directory behind', () => {
    const made: string[] = [];
    const recording: ScratchFs = { ...nodeScratchFs, makeTempDir: (prefix) => { const d = nodeScratchFs.makeTempDir(prefix); made.push(d); return d; } };
    const refused = scratchHostWith(recording, { maxFiles: 1, maxBytes: 1 << 30, maxEntries: 1000, maxPlacedBytes: 1 << 20 }).open(nodeSystem, real);
    expect(refused.ok).toBe(false);
    expect(made).toHaveLength(1);
    expect(existsSync(made[0] as string)).toBe(false);
  });
});

// ---- the independent review of 001822c4: four findings reproduced with real directories, and the LOW items ----

const WIN = process.platform === 'win32';
/** `\\?\` turns off Windows name normalisation, which is the only way to create a file named `NUL` or `CON.txt`. */
const verbatim = (p: string): string => `\\\\?\\${p}`;
/** Is 8.3 short-name generation on for the temp volume? (Only the alias-resolves check depends on it; the refusal tests do not.) */
const eightDotThreeOn = (() => {
  if (!WIN) return false;
  const probe = mkdtempSync(join(tmpdir(), 'projectos-8dot3-'));
  try {
    writeFileSync(join(probe, 'a-long-probe-name.txt'), 'x');
    return existsSync(join(probe, 'A-LONG~1.TXT'));
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

describe('review F1: 8.3 short names and other aliases of a control file', () => {
  const CONTROL_FILES: Record<string, string> = {
    'docs/.gitignore': 'ORIGINAL\n',
    'docs/.gitattributes': 'ORIGINAL\n',
    'docs/AGENTS.override.md': 'ORIGINAL\n',
    'docs/.claude/settings.json': '{"original":true}\n',
    'docs/.husky/pre-commit': 'original\n',
  };
  const ALIASES = ['GITIGN~1', 'GITATT~1', 'AGENTS~1.MD', 'CLAUDE~1/settings.json', 'HUSKY~1/pre-commit'];

  it.skipIf(!eightDotThreeOn)('the machine really does alias the control files by their short names (so the next test is not vacuous)', () => {
    for (const [rel, content] of Object.entries(CONTROL_FILES)) put(real, rel, content);
    expect(readFileSync(join(real, 'docs', 'GITIGN~1'), 'utf8')).toBe('ORIGINAL\n');
    expect(readFileSync(join(real, 'docs', 'CLAUDE~1', 'settings.json'), 'utf8')).toBe('{"original":true}\n');
  });

  it('F1: a short-name alias of a real control file is refused, whatever the grants, and the real control files are not overwritten', () => {
    for (const [rel, content] of Object.entries(CONTROL_FILES)) put(real, rel, content);
    const before = treeOf(real);
    const { scratch, inspected } = inspectAfter((root) => {
      for (const alias of ALIASES) put(root, `docs/${alias}`, 'EVIL\n');
      put(root, 'docs/ok.md', 'fine\n');
    });
    expect(inspected.kind).toBe('refused');
    expect(refusedPaths(inspected)).toEqual(['docs/AGENTS~1.MD', 'docs/CLAUDE~1', 'docs/GITATT~1', 'docs/GITIGN~1', 'docs/HUSKY~1']);
    expect(scratch.copyBack().kind).toBe('refused');
    expect(treeOf(real)).toEqual(before);
  });

  it('F1: a segment shaped like a short name (a tilde and a digit) is never a plain path, in any position', () => {
    for (const bad of ['docs/GITIGN~1', 'docs/AGENTS~1.MD', 'docs/CLAUDE~1/settings.json', 'a~2/b.md', 'docs/x~9.txt']) expect(safeRelativePath(bad), bad).toBe(false);
    expect(safeRelativePath('docs/tilde~name.md')).toBe(true);
  });

  it.skipIf(!WIN)('F1: a destination that exists under another spelling (case, on a case-insensitive volume) is refused: the canonical path must equal the expected one', () => {
    put(real, 'docs/readme.md', 'original\n');
    expect(destinationProblem(nodeScratchFs, real, 'docs/readme.md')).toBeNull();
    if (!existsSync(join(real, 'DOCS'))) return; // a case-sensitive volume has no alias to refuse
    expect(destinationProblem(nodeScratchFs, real, 'docs/README.md')).not.toBeNull();
    expect(destinationProblem(nodeScratchFs, real, 'DOCS/readme.md')).not.toBeNull();
    expect(destinationProblem(nodeScratchFs, real, 'DOCS/brand-new.md')).not.toBeNull();
    expect(destinationProblem(nodeScratchFs, real, 'docs/brand-new.md')).toBeNull();
  });

  it('F1: the control-path set also covers the other agents\' control files, under a directory grant', () => {
    const { inspected } = inspectAfter((root) => {
      for (const rel of ['docs/.cursor/rules/a.mdc', 'docs/.cursorrules', 'docs/.windsurf/rules.md', 'docs/.windsurfrules', 'docs/.mcp.json']) put(root, rel, 'x\n');
      put(root, 'docs/ok.md', 'fine\n');
    });
    expect(refusedPaths(inspected)).toEqual(['docs/.cursor/rules/a.mdc', 'docs/.cursorrules', 'docs/.mcp.json', 'docs/.windsurf/rules.md', 'docs/.windsurfrules']);
  });
});

describe('review F2: Windows reserved device names', () => {
  const RESERVED = ['NUL', 'nul', 'CON.txt', 'aux', 'AUX.', 'COM1', 'com9.log', 'COM0', 'LPT1.log', 'lpt9', 'PRN', 'CONIN$', 'CONOUT$', 'CLOCK$', 'COM\u00b9', 'COM\u00b2.txt', 'LPT\u00b3', 'Nul.tar.gz'];

  it('F2: every reserved name is refused as a path segment, with or without extension, in any case and at any depth', () => {
    for (const name of RESERVED) {
      expect(safeRelativePath(name), name).toBe(false);
      expect(safeRelativePath(`docs/${name}`), name).toBe(false);
      expect(safeRelativePath(`${name}/x.md`), name).toBe(false);
    }
    for (const fine of ['console.md', 'docs/auxiliary.md', 'COM10.txt', 'comma.md', 'nullable.ts', 'docs/lpt.md']) expect(safeRelativePath(fine), fine).toBe(true);
  });

  it.skipIf(!WIN)('F2: real files with reserved names made in a scratch are refused, never copied, and never opened by the walk', () => {
    const before = treeOf(real);
    const scratch = openScratch();
    expect(scratch.baseline()).toBeNull();
    const made = ['NUL', 'CON.txt', 'aux', 'COM1', 'LPT1.log', 'CONIN$'].map((n) => join(scratch.root, 'docs', n));
    for (const m of made) writeFileSync(verbatim(m), 'x');
    try {
      const inspected = scratch.inspect(GRANTS);
      expect(inspected.kind).toBe('refused');
      expect(refusedPaths(inspected).sort()).toEqual(['docs/NUL', 'docs/CON.txt', 'docs/aux', 'docs/COM1', 'docs/LPT1.log', 'docs/CONIN$'].sort());
      expect(scratch.copyBack().kind).toBe('refused');
      expect(treeOf(real)).toEqual(before);
    } finally {
      for (const m of made) rmSync(verbatim(m), { force: true });
    }
  });
});

describe('review F3: the export never follows a link out of the checkout', () => {
  it('F3: files that git lists beneath an untracked junction are not exported, and are reported as skipped', () => {
    const outside = join(base, 'outside');
    put(outside, 'secret.txt', 'OUTSIDE-SECRET\n');
    junction(outside, join(real, 'jl'));
    junction(outside, join(real, 'docs', 'jd'));
    const scratch = openScratch();
    const tree = treeOf(scratch.root);
    expect(Object.keys(tree).some((k) => k.endsWith('secret.txt'))).toBe(false);
    expect(Object.keys(tree)).not.toContain('jl');
    expect(Object.keys(tree)).not.toContain('docs/jd');
    expect(scratch.skipped).toEqual(expect.arrayContaining(['jl/secret.txt', 'docs/jd/secret.txt']));
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('OUTSIDE-SECRET\n');
  });

  it('F3: ordinary files and directories are still exported beside the skipped ones', () => {
    junction(join(base, 'outside-empty'), join(real, 'jl'));
    const scratch = openScratch();
    expect(readFileSync(join(scratch.root, 'docs/sub/deep.md'), 'utf8')).toBe('one\n');
    expect(scratch.skipped.every((p) => !p.startsWith('docs/sub'))).toBe(true);
  });
});

describe('review F4: the backup location is neither predictable nor inside the worker\'s tree', () => {
  it('F4: a junction planted where the backup used to be is never written through', () => {
    const victim = join(base, 'victim');
    mkdirSync(victim);
    const scratch = openScratch();
    expect(scratch.baseline()).toBeNull();
    put(scratch.root, 'docs/plain.md', 'changed\n');
    const holder = dirname(scratch.root);
    for (const name of ['backup', 'backups', 'staging', 'tmp']) junction(victim, join(holder, name));
    expect(scratch.inspect(GRANTS)).toMatchObject({ kind: 'clean', writes: 1 });
    expect(scratch.copyBack()).toMatchObject({ kind: 'copied' });
    expect(readFileSync(join(real, 'docs/plain.md'), 'utf8')).toBe('changed\n');
    expect(readdirSync(victim)).toEqual([]);
    expect(scratch.dispose()).toBeNull();
    expect(readdirSync(victim)).toEqual([]);
  });

  it('F4: the backup directory is made at copy time, outside the scratch holder, and removed with the scratch', () => {
    const made: string[] = [];
    const recording: ScratchFs = { ...nodeScratchFs, makeTempDir: (prefix) => { const d = nodeScratchFs.makeTempDir(prefix); made.push(d); return d; } };
    const scratch = openScratch(scratchHostWith(recording));
    expect(made).toHaveLength(1);
    expect(scratch.baseline()).toBeNull();
    put(scratch.root, 'docs/plain.md', 'changed\n');
    expect(scratch.inspect(GRANTS)).toMatchObject({ kind: 'clean', writes: 1 });
    expect(scratch.copyBack()).toMatchObject({ kind: 'copied' });
    expect(made).toHaveLength(2);
    expect(dirname(made[1] as string)).toBe(dirname(made[0] as string));
    expect(made[1]).not.toBe(made[0]);
    expect(dirname(scratch.root)).toBe(made[0]);
    expect((made[1] as string).startsWith(join(made[0] as string, 'checkout'))).toBe(false);
    expect(made[1] as string).not.toContain(made[0] as string);
    expect(scratch.dispose()).toBeNull();
    expect(existsSync(made[1] as string)).toBe(false);
    expect(existsSync(made[0] as string)).toBe(false);
  });

  it('F4: a staging directory that is a link, or is not empty, is refused before any real file is touched', () => {
    const before = treeOf(real);
    const victim = join(base, 'victim');
    mkdirSync(victim);
    const staging = join(base, 'staging-link');
    junction(victim, staging);
    const scratchRoot = join(base, 'scratch-root');
    put(scratchRoot, 'docs/plain.md', 'changed\n');
    const hash = createHash('sha256').update('changed\n').digest('hex');
    expect(copyBack(nodeScratchFs, scratchRoot, real, [{ path: 'docs/plain.md', hash }], staging)).toMatchObject({ kind: 'failed' });
    expect(readdirSync(victim)).toEqual([]);
    const full = join(base, 'staging-full');
    put(full, 'old.txt', 'old');
    expect(copyBack(nodeScratchFs, scratchRoot, real, [{ path: 'docs/plain.md', hash }], full)).toMatchObject({ kind: 'failed' });
    expect(treeOf(real)).toEqual(before);
  });
});

describe('review LOW items', () => {
  it('a file with more than one hard link is refused when it would be copied back', () => {
    const before = treeOf(real);
    const { scratch, inspected } = inspectAfter((root) => linkSync(join(root, 'src/other.ts'), join(root, 'docs/b.md')));
    expect(inspected.kind).toBe('refused');
    expect(refusedPaths(inspected)).toEqual(['docs/b.md']);
    expect(scratch.copyBack().kind).toBe('refused');
    expect(treeOf(real)).toEqual(before);
  });

  it('what is judged in the scratch after the run is bounded by the same limits as the export', () => {
    const limited = scratchHostWith(nodeScratchFs, { maxFiles: 40, maxBytes: 20_000, maxEntries: 1000, maxPlacedBytes: 4096 });
    const many = openScratch(limited);
    expect(many.baseline()).toBeNull();
    for (let i = 0; i < 60; i += 1) put(many.root, `docs/many/f${i}.md`, 'x');
    expect(many.inspect(GRANTS)).toMatchObject({ kind: 'unreadable' });
    const big = openScratch(limited);
    expect(big.baseline()).toBeNull();
    put(big.root, 'docs/big.bin', Buffer.alloc(100_000, 1));
    const out = big.inspect(GRANTS);
    expect(out).toMatchObject({ kind: 'unreadable' });
    expect(big.copyBack().kind).not.toBe('copied');
  });

  it('refusal text escapes control, bidirectional-override and other format characters, and is bounded', () => {
    const shown = plainName(`src/a\u202eb\u2066c\u200bd\u0007e\u2028f${'x'.repeat(400)}`);
    expect(shown).toContain('\\u{202e}');
    expect(shown).toContain('\\u{2066}');
    expect(shown).toContain('\\u{200b}');
    expect(shown).toContain('\\u{7}');
    expect(shown).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/);
    expect(shown.length).toBeLessThanOrEqual(320);
    expect(plainName('docs/ordinary é.md')).toBe('docs/ordinary é.md');
  });

  it('rule 9 as a scenario: a worker that writes, reads back and undoes leaves the real tree untouched and copies nothing (the validator pins the comparison, not this scenario)', () => {
    const before = treeOf(real);
    const { scratch, inspected } = inspectAfter((root) => {
      put(root, 'docs/plain.md', 'temporarily different\n');
      expect(readFileSync(join(root, 'docs/plain.md'), 'utf8')).toBe('temporarily different\n');
      put(root, 'docs/plain.md', 'one\n');
      put(root, 'src/other.ts', 'scribble\n');
      put(root, 'src/other.ts', 'one\n');
    });
    expect(inspected).toMatchObject({ kind: 'clean', writes: 0 });
    expect(scratch.copyBack()).toMatchObject({ kind: 'copied', paths: [] });
    expect(treeOf(real)).toEqual(before);
  });
});
