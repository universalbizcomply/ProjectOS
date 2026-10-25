/**
 * The candidate is what a commit would record — not what asking the question wrote down.
 *
 * THE SELF-INVALIDATING SEAM THIS CLOSES. The candidate identity is captured while the evidence is
 * built, which is before the gatekeeper is asked. The ask then writes, inside the governed root, the
 * records ProjectOS keeps about having asked: the spend ledger with its lock and temporary file, the
 * thread continuity record, the decision evidence, and the durable work checkpoint. All of them are
 * tracked files here. So when the executor re-derives the candidate to check it against the decision,
 * the candidate has moved — because the question was asked — and the continuation refuses with "the
 * candidate changed after the gatekeeper reviewed it" about a change nobody made. Nothing could ever
 * have been committed through the governed route.
 *
 * WHY NO EXISTING TEST CAUGHT IT. The end-to-end proof supplies no ledger and no decision-evidence
 * port; those are injected only by the real entrypoint. The fixture therefore never writes the
 * records that do the damage, and the seam stayed invisible while looking thoroughly proven.
 *
 * REAL GIT THROUGHOUT, because the boundary is `git status --porcelain --untracked-files=all` and the
 * identities are real blob ids. A fixture cannot tell the truth about either.
 *
 * Created in PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nodeSystem, resolveBoundGit } from '../src/system.js';
import { computeCandidateIdentity } from '../src/loop/candidateIdentity.js';
import {
  GATEKEEPER_DECISIONS_REL,
  GATEKEEPER_LEDGER_LOCK_REL,
  GATEKEEPER_LEDGER_REL,
  GATEKEEPER_THREAD_REL,
} from '../src/loop/gatekeeperConfig.js';
import { WORK_RECORD_REL } from '../src/loop/workRecord.js';

const GIT = resolveBoundGit(process.env) as string;

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

/** A repository with one commit, so "changed since HEAD" means something. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'projectos-candidate-'));
  made.push(root);
  git(root, 'init', '--quiet', '--initial-branch=work');
  git(root, 'config', 'user.email', 'e2e@example.invalid');
  git(root, 'config', 'user.name', 'ProjectOS E2E');
  write(root, 'src/product.ts', 'export const x = 1;\n');
  write(root, '.projectops/plan.json', '{"planId":"p1"}\n');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'base');
  return root;
}

function write(root: string, rel: string, text: string): void {
  const p = join(root, ...rel.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

function digest(root: string): string {
  const r = computeCandidateIdentity(nodeSystem, root);
  if (!r.ok) throw new Error(`candidate refused: ${r.problems.join('; ')}`);
  return r.identity.digest;
}

function paths(root: string): readonly string[] {
  const r = computeCandidateIdentity(nodeSystem, root);
  if (!r.ok) throw new Error(`candidate refused: ${r.problems.join('; ')}`);
  return r.identity.entries.map((e) => e.path);
}

/**
 * Everything a real gatekeeper turn writes into the governed root, by the same constants the
 * writers use. This is the production seam reproduced, not an approximation of it.
 */
function writeAskingRecords(root: string, requestId = 'GKREQ-abc123'): void {
  write(root, GATEKEEPER_LEDGER_REL, '[{"requestId":"GKREQ-abc123","costMicroUsd":41234}]\n');
  write(root, `${GATEKEEPER_LEDGER_REL}.tmp`, '[]\n');
  write(root, GATEKEEPER_LEDGER_LOCK_REL, '{"heldSince":"2026-09-02T20:00:00Z"}\n');
  write(root, `${GATEKEEPER_LEDGER_LOCK_REL}.leaked`, '{"leaked":true}\n');
  write(root, GATEKEEPER_THREAD_REL, '{"providerThreadId":"t-1","previousResponseId":"resp-9"}\n');
  write(root, `${GATEKEEPER_DECISIONS_REL}/${requestId}.json`, '{"verdict":"APPROVED_TO_PROCEED"}\n');
  write(root, WORK_RECORD_REL, '{"state":"AWAITING_GATE"}\n');
}

/* ------------------------------------------------------------------------------------------------
 * PROOF 1 / 2 — the production seam, and that it is closed.
 * --------------------------------------------------------------------------------------------- */

describe('asking the gatekeeper does not change what the answer is about', () => {
  it('the reviewed digest survives every record a real turn writes', () => {
    const root = repo();
    // The work under review.
    write(root, 'src/product.ts', 'export const x = 2;\n');
    const reviewed = digest(root);

    // The turn happens. ProjectOS records that it asked.
    writeAskingRecords(root);

    // GREEN: the executor re-derives the candidate and finds the same bytes it showed the reviewer.
    expect(digest(root)).toBe(reviewed);
    // And none of the bookkeeping is inside the candidate at all.
    expect(paths(root)).toEqual(['src/product.ts']);
  });

  // RED, stated as the thing that must remain true of the old behaviour: every one of these records
  // IS reported by git as changed. If any stopped being tracked-and-visible the exclusion would be
  // pointless, and if the filter were removed each would re-enter the candidate.
  it('git really does report every one of those records as changed', () => {
    const root = repo();
    writeAskingRecords(root);
    const seen = git(root, 'status', '--porcelain', '--untracked-files=all');
    for (const rel of [
      GATEKEEPER_LEDGER_REL,
      `${GATEKEEPER_LEDGER_REL}.tmp`,
      GATEKEEPER_LEDGER_LOCK_REL,
      `${GATEKEEPER_LEDGER_LOCK_REL}.leaked`,
      GATEKEEPER_THREAD_REL,
      `${GATEKEEPER_DECISIONS_REL}/GKREQ-abc123.json`,
      WORK_RECORD_REL,
    ]) {
      expect(seen).toContain(rel);
    }
    // ...and yet the candidate is empty, because none of them is work.
    expect(paths(root)).toEqual([]);
  });

  it('a run that produced nothing but bookkeeping has an empty candidate, not a false one', () => {
    const root = repo();
    const clean = digest(root);
    writeAskingRecords(root);
    expect(digest(root)).toBe(clean);
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOFS 3, 4 — the binding itself is untouched.
 * --------------------------------------------------------------------------------------------- */

describe('one byte still moves the candidate', () => {
  it('a single changed byte in a real candidate file changes the digest', () => {
    const root = repo();
    write(root, 'src/product.ts', 'export const x = 2;\n');
    const before = digest(root);
    write(root, 'src/product.ts', 'export const x = 3;\n');
    expect(digest(root)).not.toBe(before);
  });

  it('adding, deleting and renaming a candidate file each change the digest', () => {
    const root = repo();
    write(root, 'src/product.ts', 'export const x = 2;\n');
    const base = digest(root);

    write(root, 'src/added.ts', 'export const y = 1;\n');
    const added = digest(root);
    expect(added).not.toBe(base);

    rmSync(join(root, 'src', 'added.ts'));
    expect(digest(root)).toBe(base);

    rmSync(join(root, 'src', 'product.ts'));
    const deleted = digest(root);
    expect(deleted).not.toBe(base);

    write(root, 'src/renamed.ts', 'export const x = 1;\n');
    expect(digest(root)).not.toBe(deleted);
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOFS 5, 6 — what must stay inside, stays inside.
 * --------------------------------------------------------------------------------------------- */

describe('nothing that matters was excluded', () => {
  it('the B9 proof artifact is inside the candidate', () => {
    const root = repo();
    write(root, '.projectops/proof/PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A.json', '{"pilotState":"pending"}\n');
    const before = digest(root);
    expect(paths(root)).toContain('.projectops/proof/PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A.json');

    write(root, '.projectops/proof/PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A.json', '{"pilotState":"proven"}\n');
    expect(digest(root)).not.toBe(before);
  });

  it.each([
    ['source', 'src/product.ts', 'export const x = 9;\n'],
    ['a plan', '.projectops/plan.json', '{"planId":"p2"}\n'],
    ['configuration', '.projectops/project-config.json', '{"projectId":"e2e"}\n'],
    ['gatekeeper configuration', '.projectops/gatekeeper.json', '{"enabled":true}\n'],
    ['an authority record', '.projectops/authority/closure-delegation.json', '{"delegatedTo":"ChatGPT"}\n'],
    ['a phase record', '.projectops/phases/SOME-PHASE1A.json', '{"status":"closed"}\n'],
    ['an owner receipt', '.projectops/gates/SOME-PHASE1A.commit.json', '{"ownerChoice":"APPROVE"}\n'],
    ['worker findings', '.projectops/execution/s1.findings.json', '{"findings":[]}\n'],
    ['worker effects', '.projectops/execution/s1.effects.json', '{"productionTouched":false}\n'],
  ])('%s stays inside the candidate', (_what, rel, text) => {
    const root = repo();
    const before = digest(root);
    write(root, rel, text);
    expect(paths(root)).toContain(rel);
    expect(digest(root)).not.toBe(before);
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOFS 7, 8 — the exclusion cannot be widened, aimed, or used to hide work.
 * --------------------------------------------------------------------------------------------- */

describe('the exclusion is closed and cannot conceal work', () => {
  it('a file merely NAMED like a control-plane record is still candidate-bound', () => {
    const root = repo();
    for (const rel of [
      // Near-misses, one character or one level away from an excluded path.
      '.projectops/gatekeeper-ledger.json.bak',
      '.projectops/gatekeeper-ledgerX.json',
      '.projectops/work.v2.json',
      '.projectops/gatekeeper-decisions.json',
      // Nested under the decisions directory: not something this runtime writes.
      `${GATEKEEPER_DECISIONS_REL}/nested/GKREQ-1.json`,
      // In the decisions directory but not a decision record.
      `${GATEKEEPER_DECISIONS_REL}/notes.md`,
      // A NAME THE WRITER COULD NEVER PRODUCE. `gatekeeperDecisionEvidenceRelPath` refuses any
      // request id outside [A-Za-z0-9_-]{4,128}, so these are not decision evidence however much
      // they look like it — matching only the directory would have waved them through.
      `${GATEKEEPER_DECISIONS_REL}/anything i want.json`,
      `${GATEKEEPER_DECISIONS_REL}/GK.REQ.json`,
      `${GATEKEEPER_DECISIONS_REL}/ab.json`,
    ]) {
      write(root, rel, 'x\n');
      expect(paths(root)).toContain(rel);
    }
  });

  it('source hidden under a control-plane name is still candidate-bound', () => {
    const root = repo();
    // The attack the exclusion must not enable: smuggling real work through an excluded path.
    write(root, `${GATEKEEPER_DECISIONS_REL}/GKREQ-real.json`, '{"verdict":"APPROVED_TO_PROCEED"}\n');
    write(root, `${GATEKEEPER_DECISIONS_REL}/GKREQ-real.ts`, 'export const smuggled = true;\n');
    const inside = paths(root);
    expect(inside).toContain(`${GATEKEEPER_DECISIONS_REL}/GKREQ-real.ts`);
    expect(inside).not.toContain(`${GATEKEEPER_DECISIONS_REL}/GKREQ-real.json`);
  });

  it('only the writer-shaped decision filename is excluded', () => {
    const root = repo();
    // Exactly what `gatekeeperDecisionEvidenceRelPath` produces: excluded.
    write(root, `${GATEKEEPER_DECISIONS_REL}/GKREQ-9d85911fbb1ac1b3.json`, '{"verdict":"APPROVED_TO_PROCEED"}' + '\n');
    expect(paths(root)).toEqual([]);
    // One character outside the writer's charset: candidate-bound.
    write(root, `${GATEKEEPER_DECISIONS_REL}/GKREQ+9d85911f.json`, '{"smuggled":true}' + '\n');
    expect(paths(root)).toContain(`${GATEKEEPER_DECISIONS_REL}/GKREQ+9d85911f.json`);
  });

  it('the excluded set is a closed literal list with no wildcard and no caller input', () => {
    const raw = readFileSync(new URL('../src/loop/candidateIdentity.ts', import.meta.url), 'utf8');
    // COMMENTS STRIPPED FIRST. The prose explains what the exclusion deliberately is NOT, and naming
    // the forbidden shape in order to reject it must not read as using it. The same rule the
    // governed validators apply when they assert about source.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    // No pattern matching of any kind against the repository-relative path.
    expect(code).not.toContain('.projectops/**');
    expect(code).not.toMatch(/new RegExp|minimatch|glob/);
    const src = code;
    // The set comes from the modules that own the paths, so a rename moves the exclusion with it.
    for (const name of [
      'GATEKEEPER_LEDGER_REL',
      'GATEKEEPER_LEDGER_LOCK_REL',
      'GATEKEEPER_THREAD_REL',
      'GATEKEEPER_DECISIONS_REL',
      'WORK_RECORD_REL',
    ]) {
      expect(src).toContain(name);
    }
    // And it is derived, never supplied: the signature takes no boundary.
    //
    // PROJECTOS-HOST-REVIEW-PATH1B, UNIT L — DECLARED AMENDMENT of this pin.
    //   OLD: `(sys: System, root: string)` — two parameters, no boundary, no runner.
    //   NEW: an optional third parameter `run?: CandidateGit` — HOW a git question is asked (the bounded
    //   local candidate commit passes its hook-and-config-isolated runner), never WHICH paths answer:
    //   `CandidateGit` receives the argument list this module built and returns an ExecResult, so it can
    //   name no path, no boundary and no repository of its own. The boundary still comes only from
    //   `git status` minus the closed asking-record set, unchanged above.
    expect(src).toContain('export function computeCandidateIdentity(sys: System, root: string, run?: CandidateGit): CandidateResult');
    expect(src).toContain('export type CandidateGit = (args: readonly string[]) => ExecResult;');
  });

  it('excluded records cannot enter the candidate even when everything else is staged', () => {
    const root = repo();
    write(root, 'src/product.ts', 'export const x = 5;\n');
    writeAskingRecords(root);
    git(root, 'add', '--all');
    // Staged or not makes no difference: the candidate is the work, and the bookkeeping is not work.
    expect(paths(root)).toEqual(['src/product.ts']);
  });
});
