/**
 * A STALE INTERACTIVE QUESTION IS SUPERSEDED THROUGH A GOVERNED COMMAND — PROJECTOS-BOOT-CONTINUE1A.
 *
 * A run that died left its question on disk, and every later run refused to accept any answer to it
 * (rightly: nobody can establish that ProjectOS asked it, so a planted answer would look genuine). The
 * only way out was deleting files by hand. `--supersede-stale-request` now ARCHIVES the stale question
 * and any answer beside it, with a record, and asks afresh — so only an answer saved after THIS run
 * asked can apply, and an already-acted-on question can never be revived.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeSystem } from '../src/system.js';
import { nodeInteractivePort, GATEKEEPER_INTERACTIVE_REL } from '../src/loop/gatekeeperHandoff.js';
import { awaitInteractiveAnswer, type InteractiveQuestion } from '../src/loop/interactiveGatekeeper.js';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

const REQ = 'GKREQ-0123456789abcdef01234567';

function setup(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'projectos-stale-'));
  made.push(root);
  const dir = join(root, ...GATEKEEPER_INTERACTIVE_REL.split('/'));
  mkdirSync(dir, { recursive: true });
  return { root, dir };
}

function question(): InteractiveQuestion {
  return { requestId: REQ, schemaVersion: '1.0.0', note: 'the question' } as unknown as InteractiveQuestion;
}

const planted = JSON.stringify({ decisionId: `GKDEC-${REQ}`, decision: 'APPROVED_TO_PROCEED' });

describe('stale interactive request recovery', () => {
  it('WITHOUT the flag a pre-existing question is still refused, and the refusal names the governed flag', () => {
    const { root, dir } = setup();
    writeFileSync(join(dir, `${REQ}.request.json`), `${JSON.stringify(question(), null, 2)}\n`);
    const r = awaitInteractiveAnswer(nodeInteractivePort(nodeSystem, root, { waitMs: 0 }), question());
    expect(r.kind).toBe('stop');
    expect(r.kind === 'stop' && r.cause).toBe('pre-existing');
    expect(r.kind === 'stop' && r.reasons.join(' ')).toContain('--supersede-stale-request');
    expect(existsSync(join(dir, `${REQ}.request.json`))).toBe(true);
  });

  it('WITH the flag the stale question and a planted answer are archived with a record, and the planted answer never applies', () => {
    const { root, dir } = setup();
    writeFileSync(join(dir, `${REQ}.request.json`), `${JSON.stringify(question(), null, 2)}\n`);
    writeFileSync(join(dir, `${REQ}.decision.json`), planted);
    const r = awaitInteractiveAnswer(nodeInteractivePort(nodeSystem, root, { waitMs: 0, supersedeStale: true }), question());
    // Asked afresh and now WAITING: the planted answer was moved away, not accepted.
    expect(r.kind).toBe('stop');
    expect(r.kind === 'stop' && r.cause).toBe('waiting');
    expect(existsSync(join(dir, `${REQ}.request.json`))).toBe(true);
    expect(existsSync(join(dir, `${REQ}.decision.json`))).toBe(false);
    const archived = readdirSync(join(dir, 'superseded'));
    expect(archived.some((f) => f.endsWith('.request.json'))).toBe(true);
    expect(archived.some((f) => f.endsWith('.decision.json'))).toBe(true);
    expect(archived.some((f) => f.endsWith('.supersession.json'))).toBe(true);
  });

  it('an answer saved AFTER the fresh question is the one that applies', () => {
    const { root, dir } = setup();
    writeFileSync(join(dir, `${REQ}.request.json`), `${JSON.stringify(question(), null, 2)}\n`);
    const port = nodeInteractivePort(nodeSystem, root, { waitMs: 0, supersedeStale: true });
    expect(port.publishRequest(question())).toBe('written');
    writeFileSync(join(dir, `${REQ}.decision.json`), planted);
    const read = port.awaitDecision(REQ);
    expect(read.kind).toBe('present');
  });

  it('an orphan answer with no question is archived, then the question is asked afresh', () => {
    const { root, dir } = setup();
    writeFileSync(join(dir, `${REQ}.decision.json`), planted);
    const port = nodeInteractivePort(nodeSystem, root, { waitMs: 0, supersedeStale: true });
    expect(port.publishRequest(question())).toBe('written');
    expect(existsSync(join(dir, `${REQ}.decision.json`))).toBe(false);
  });

  it('a question already answered and acted on is never superseded', () => {
    const { root, dir } = setup();
    writeFileSync(join(dir, `${REQ}.request.json`), `${JSON.stringify(question(), null, 2)}\n`);
    writeFileSync(join(dir, `${REQ}.decision.json`), planted);
    writeFileSync(join(dir, `${REQ}.consumed.json`), '{}');
    const port = nodeInteractivePort(nodeSystem, root, { waitMs: 0, supersedeStale: true });
    expect(port.publishRequest(question())).toContain('already answered and acted on');
    expect(existsSync(join(dir, `${REQ}.decision.json`))).toBe(true);
  });
});
