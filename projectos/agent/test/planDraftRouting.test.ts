/**
 * WHICH OPERATION ANSWERS AN OBJECTIVE — proven at the command, where the choice is actually made.
 *
 * THE DEFECT THIS FILE EXISTS FOR. `plan draft` runs two different operations: objective-led
 * AUTHORING (A) and corpus-led IMPORT (B). It chooses between them on a flag, and it read that flag
 * only as a BOOLEAN — which is what the CLI's parser produces for a bare `--authored`. The governed
 * channel carries typed STRING arguments and can only say `'true'`, and its argument spec did not
 * even accept the field. So the Control Centre sent an owner's objective, the command silently
 * declined to author it, and route B answered instead: "Start Something New" reached the surface and
 * never reached the author. No provider call could be made from the product at all.
 *
 * It was found during the dev-tree live proof, at the last moment before a paid dispatch — every unit
 * test passed throughout, because no test asked which operation an OBJECTIVE FROM THE SURFACE takes.
 * That is the question this file asks.
 *
 * NOTHING HERE DISPATCHES ANYTHING. No author is composed in any of these fixtures, so the refusal
 * paths are what run; the assertions include that no ledger row and no draft appear.
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

import { plan as planCommand } from '../src/commands/plan.js';
import { listDrafts } from '../src/planIntake.js';
import type { System } from '../src/system.js';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

const OBJECTIVE =
  'Create the smallest credible one-phase read-only plan to verify programme status and report on it.';

const PLAN_DOC = [
  '# Acme plan',
  'projectId: acme',
  'Vision: a reliable ordering system.',
  'Definition of complete: every ordering journey works end to end and is proven.',
  'Success standard: proven live rather than asserted.',
  '',
  '## Environments',
  '- local — production freeze: yes',
  '',
  '## Approved scope',
  '- the ordering journey',
  '',
  '## Excluded scope',
  '- anything touching production',
  '',
  '## Phases',
  '',
  '### ACME-P1A — Ordering journey',
  'Purpose: build the ordering journey.',
  'Risk: medium',
  'Autonomy: local-safe',
  'Browser proof: no',
  'Acceptance criteria:',
  '- a customer can place an order',
  'Required validators: validate-all',
  'Required reviews: code-review',
  'Owner gates: commit, push, phase-closure',
].join('\n');

/** A governed project. `gatekeeper` and `permission` are added only when a test wants that gate reached. */
function project(opts: { readonly gatekeeper?: boolean } = {}): { root: string; sys: System } {
  const root = mkdtempSync(pjoin(tmpdir(), 'projectos-routing-')).replace(/\\/g, '/');
  created.push(root);
  const write = (rel: string, text: string): void => {
    const abs = pjoin(root, ...rel.split('/'));
    mkdirSync(pjoin(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
  };
  write('docs-plan.md', PLAN_DOC);
  write(
    '.projectops/project-config.json',
    JSON.stringify({
      projectId: 'acme',
      projectName: 'Acme',
      projectType: 'app',
      owner: 'Ada',
      repo: 'acme/app',
      localPath: root,
      protectedBranches: ['main'],
      productionFreeze: true,
      allowedActions: ['inspect-repository'],
      forbiddenActions: ['production-deploy'],
      approvalGates: ['commit'],
      validators: ['validate-all'],
      evidenceRequirements: ['evidence-pack'],
      installStatus: 'installed',
      secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true, notes: 'no raw secrets' },
      planSources: ['docs-plan.md'],
    }),
  );
  if (opts.gatekeeper === true) {
    write(
      '.projectops/gatekeeper.json',
      JSON.stringify({
        schemaVersion: '1.0.0',
        enabled: true,
        transport: {
          transportId: 'openai-primary',
          kind: 'openai-responses',
          model: 'gpt-5.6-terra',
          capabilities: ['submit-request', 'receive-decision'],
          credentialRef: 'OPENAI_GATEKEEPER_KEY',
          commercialApproval: true,
          decidedBy: 'Gatekeeper',
        },
        modelPolicy: { routineModel: 'gpt-5.6-luna', strongModel: 'gpt-5.6-terra' },
        rateCards: {
          'gpt-5.6-terra': { model: 'gpt-5.6-terra', inputMicroUsdPerMillion: 1250000, cachedInputMicroUsdPerMillion: 125000, outputMicroUsdPerMillion: 10000000 },
          'gpt-5.6-luna': { model: 'gpt-5.6-luna', inputMicroUsdPerMillion: 100000, cachedInputMicroUsdPerMillion: 10000, outputMicroUsdPerMillion: 400000 },
        },
        budget: { initialCreditMicroUsd: 5000000, warnAtMicroUsd: 2000000, hardStopAtMicroUsd: 5000000, phaseHardStopAtMicroUsd: 5000000, dayHardStopAtMicroUsd: 5000000, autoRecharge: false },
        budgetRaiseAuthorities: [],
        threadBinding: { schemaVersion: '1.0.0', projectId: 'acme', repositoryRoot: root, providerThreadId: 't-1', transportId: 'openai-primary', createdAt: '2026-08-27T00:00:00+01:00' },
        programmeId: 'acme-v1',
      }),
    );
  }

  const sys: System = {
    cwd: () => root,
    now: () => '2026-08-27T15:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(pjoin(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    // Enough git for the intake to establish branch and head; `git show` answers nothing, which is
    // exactly right — no record here is committed, so every committed read must refuse.
    exec: (_cmd: string, args: readonly string[]) => {
      const key = args.join(' ');
      if (key.endsWith('rev-parse HEAD')) return { code: 0, stdout: 'a'.repeat(40), stderr: '' };
      if (key.endsWith('rev-parse --abbrev-ref HEAD')) return { code: 0, stdout: 'main', stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    },
  } as System;

  return { root, sys };
}

const run = (w: { root: string; sys: System }, flags: Record<string, string | boolean>) =>
  planCommand({ sys: w.sys, root: w.root }, { objective: OBJECTIVE, ...flags }, ['draft']);

/** Nothing was spent: no project cost ledger, and no installation row could exist without one. */
function nothingSpent(root: string): boolean {
  return !existsSync(pjoin(root, '.projectops', 'gatekeeper-ledger.json'));
}

describe('an objective is answered by the operation that was asked for', () => {
  test('NO flag means IMPORT — the behaviour every earlier caller relied on', () => {
    const w = project();
    const r = run(w, {});
    expect(r.code).toBe(0);
    const drafts = listDrafts(w.sys, w.root);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.origin ?? 'import').toBe('import');
    expect(r.lines.join('\n')).toContain('importing this repository');
    expect(nothingSpent(w.root)).toBe(true);
  });

  test("authored: 'false' is IMPORT, stated rather than assumed", () => {
    const w = project();
    const r = run(w, { authored: 'false' });
    expect(r.code).toBe(0);
    expect((listDrafts(w.sys, w.root)[0]!.origin ?? 'import')).toBe('import');
  });

  test('the CLI boolean --authored reaches the AUTHORING path', () => {
    // No gatekeeper configuration, so authoring cannot be composed and the command REFUSES. The
    // refusal is the proof the authoring path was taken: import would have succeeded.
    const w = project();
    const r = run(w, { authored: true });
    expect(r.code).not.toBe(0);
    expect(r.lines.join('\n')).toContain('AUTHOR_NOT_COMPOSED');
    expect(listDrafts(w.sys, w.root)).toHaveLength(0);
  });

  test("the governed STRING authored: 'true' reaches the same AUTHORING path", () => {
    // THE ACTUAL BUG. This is what the Control Centre sends, and it used to fall through to import.
    const w = project();
    const r = run(w, { authored: 'true' });
    expect(r.code).not.toBe(0);
    expect(r.lines.join('\n')).toContain('AUTHOR_NOT_COMPOSED');
    expect(listDrafts(w.sys, w.root)).toHaveLength(0);
  });

  test('the two spellings are indistinguishable in outcome', () => {
    const a = run(project(), { authored: true });
    const b = run(project(), { authored: 'true' });
    expect(a.code).toBe(b.code);
    expect(a.lines.join('\n')).toBe(b.lines.join('\n'));
  });
});

describe('authoring refuses rather than falling back', () => {
  test('authoring that cannot be composed refuses, says why, and writes NO draft', () => {
    // `composeAuthor` asks its gates in order — governed context, then pricing, then the two
    // committed factors — and refuses at the FIRST that fails. Which gate that is depends on the
    // fixture; what must never depend on the fixture is that the refusal IS a refusal. The specific
    // permission and allowlist refusals are proven where they are decided, on the trusted side, in
    // `brokeredAuthoringBoundary.test.ts`.
    const w = project();
    const r = run(w, { authored: 'true' });
    expect(r.code).not.toBe(0);
    expect(r.lines.join(String.fromCharCode(10))).toContain('AUTHOR_NOT_COMPOSED');
    // THE POINT: an import draft is NOT produced as a consolation prize.
    expect(listDrafts(w.sys, w.root)).toHaveLength(0);
    expect(existsSync(pjoin(w.root, '.projectops', 'objectives'))).toBe(false);
    expect(nothingSpent(w.root)).toBe(true);
  });

  test('the refusal says what is missing, not merely that authoring is unavailable', () => {
    // A generic "authoring unavailable" sends the owner looking in the wrong place. `composeAuthor`
    // refuses at the first gate that fails and names THAT gate; here it is the governed context,
    // because these fixtures declare no active approved plan.
    const r = run(project(), { authored: 'true' });
    const said = r.lines.join(String.fromCharCode(10));
    expect(said).toContain('REFUSED (AUTHOR_NOT_COMPOSED)');
    expect(said).toContain('governed ProjectOS project');
    // And it is a sentence, not a code.
    expect(said.length).toBeGreaterThan(60);
  });

  test('no refusal path ever produces an imported draft', () => {
    for (const w of [project(), project({ gatekeeper: true })]) {
      const r = run(w, { authored: 'true' });
      expect(r.code).not.toBe(0);
      expect(listDrafts(w.sys, w.root)).toHaveLength(0);
    }
  });

  test('nothing in this file dispatched a provider call', () => {
    // Every fixture above ran to a refusal or to corpus import; neither reaches a transport. A cost
    // ledger is written only when a call is admitted, so its absence is the evidence.
    const w = project({ gatekeeper: true });
    run(w, { authored: 'true' });
    run(w, {});
    expect(nothingSpent(w.root)).toBe(true);
  });
});
