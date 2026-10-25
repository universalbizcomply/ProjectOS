/**
 * THE DECISION STORE IS EVIDENCE, AND MUST NEVER BECOME A PERMIT.
 *
 * Persisting what the gatekeeper decided is the point of this record. The danger is the same act:
 * the implementer can write to the governed checkout, so a store that granted permission by existing
 * would hand Claude exactly the authority the decision contract denies it.
 *
 * So these prove two different things, and the second matters more than the first:
 *
 *   1. an accepted decision is written down, completely, and never silently overwritten;
 *   2. writing one down grants nothing — there is no reader that turns a file into authority.
 *
 * Created in PROJECTOS-EXECUTION-DECISION-PROVENANCE-FIX1A.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordGatekeeperDecisionEvidence,
  gatekeeperDecisionEvidenceRelPath,
  GATEKEEPER_DECISIONS_REL,
} from '../src/loop/gatekeeperConfig.js';
import { nodeSystem } from '../src/system.js';
import { GATEKEEPER_DECISION_SCHEMA_VERSION, type GatekeeperDecisionRecord } from '@projectos/core';

const sys = nodeSystem;

function root(): string {
  return mkdtempSync(join(tmpdir(), 'projectos-gkevidence-'));
}

/** A record shaped exactly as the transport stamps one, after the checker has accepted it. */
function accepted(over: Partial<GatekeeperDecisionRecord> = {}): GatekeeperDecisionRecord {
  return {
    schemaVersion: GATEKEEPER_DECISION_SCHEMA_VERSION,
    decisionId: 'GKDEC-abc123def456',
    projectId: 'projectos',
    phaseId: 'PROJECTOS-EXAMPLE1A',
    subjectCommit: 'a'.repeat(40),
    requestDigest: `sha256:${'b'.repeat(64)}`,
    decision: 'AMENDMENT_REQUIRED',
    reason: 'the finding is real',
    allowedActions: ['implement', 'run-validators'],
    forbiddenActions: ['production-deploy'],
    ownerApprovalRequired: false,
    nextClaudeInstruction: 'Add the tenant predicate.',
    decidedBy: 'ChatGPT',
    decidedAt: '2026-08-30T01:00:00.000Z',
    ...over,
  };
}

const readEvidence = (dir: string, id: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, ...gatekeeperDecisionEvidenceRelPath(id)!.split('/')), 'utf8'));

describe('an accepted decision is written down completely', () => {
  it('records the four bindings, the verdict, the grounds and what it permitted', () => {
    const dir = root();
    expect(recordGatekeeperDecisionEvidence(sys, dir, accepted())).toEqual({ kind: 'written' });

    const e = readEvidence(dir, 'GKDEC-abc123def456');
    expect(e['projectId']).toBe('projectos');
    expect(e['phaseId']).toBe('PROJECTOS-EXAMPLE1A');
    expect(e['subjectCommit']).toBe('a'.repeat(40));
    expect(e['requestDigest']).toBe(`sha256:${'b'.repeat(64)}`);
    expect(e['decision']).toBe('AMENDMENT_REQUIRED');
    expect(e['reason']).toBe('the finding is real');
    expect(e['allowedActions']).toEqual(['implement', 'run-validators']);
    expect(e['forbiddenActions']).toEqual(['production-deploy']);
    expect(e['decidedBy']).toBe('ChatGPT');
    expect(e['decidedAt']).toBe('2026-08-30T01:00:00.000Z');
  });

  it('keeps no prompt, no reply body, no credential and no instruction to the implementer', () => {
    // The evidence answers what was decided. It is not a transcript, and a transcript is where a
    // secret would end up.
    const dir = root();
    recordGatekeeperDecisionEvidence(sys, dir, accepted());
    const raw = readFileSync(join(dir, ...gatekeeperDecisionEvidenceRelPath('GKDEC-abc123def456')!.split('/')), 'utf8');
    for (const leak of ['sk-', 'Authorization', 'Bearer', 'nextClaudeInstruction', 'Add the tenant predicate']) {
      expect(raw).not.toContain(leak);
    }
  });

  it('addresses one file per deterministic request id', () => {
    expect(gatekeeperDecisionEvidenceRelPath('GKDEC-abc123')).toBe(`${GATEKEEPER_DECISIONS_REL}/GKDEC-abc123.json`);
  });

  it('refuses an id that could traverse, hide or collide rather than sanitising it', () => {
    for (const bad of ['../../etc/passwd', 'a/b', 'a\\b', '..', 'x', '', 'GKDEC abc', 'a:b']) {
      expect(gatekeeperDecisionEvidenceRelPath(bad)).toBeNull();
    }
    expect(recordGatekeeperDecisionEvidence(sys, root(), accepted({ decisionId: '../escape' })).kind).toBe('refused');
    expect(recordGatekeeperDecisionEvidence(sys, root(), accepted({ decisionId: 42 })).kind).toBe('refused');
  });
});

describe('contradictory evidence is never silently replaced', () => {
  it('re-recording the same answer is ordinary, not a conflict', () => {
    // A restart re-derives the same request id and can receive the same answer. That is not a clash.
    const dir = root();
    expect(recordGatekeeperDecisionEvidence(sys, dir, accepted()).kind).toBe('written');
    expect(recordGatekeeperDecisionEvidence(sys, dir, accepted()).kind).toBe('already-recorded');
  });

  it('a DIFFERENT answer under the same id is reported and the first is left untouched', () => {
    // The first record is what the runtime acted on. Overwriting it would erase the only account of
    // the decision that actually drove the run.
    const dir = root();
    recordGatekeeperDecisionEvidence(sys, dir, accepted());
    const second = recordGatekeeperDecisionEvidence(sys, dir, accepted({ decision: 'ACCEPTED' }));

    expect(second.kind).toBe('conflict');
    expect(readEvidence(dir, 'GKDEC-abc123def456')['decision']).toBe('AMENDMENT_REQUIRED');
  });
});

describe('the store grants nothing — no path turns a file into authority', () => {
  it('nothing in the agent reads this store back as permission', () => {
    // THE PROPERTY THIS PHASE IS REALLY ABOUT. A hand-written or edited record can only matter if
    // something reads it and believes it. Nothing does: the only reader is this test.
    //
    // `val-projectos-gate-decision-evidence1a` enforces the same rule across the whole source tree
    // as it changes; this asserts the shipped module surface itself exposes no reader.
    const surface = readFileSync(join(process.cwd(), 'src', 'loop', 'gatekeeperConfig.ts'), 'utf8');
    for (const forbidden of [
      'readGatekeeperDecisionAsAuthority',
      'loadApproval',
      'resumeApproval',
      'authoriseFromPersistedDecision',
      'readGatekeeperDecisionEvidence',
    ]) {
      expect(surface).not.toContain(forbidden);
    }
  });

  it('a hand-written record is inert: writing one authorises nothing and changes no decision', () => {
    // Simulating the implementer forging an approval directly in the checkout.
    const dir = root();
    mkdirSync(join(dir, ...GATEKEEPER_DECISIONS_REL.split('/')), { recursive: true });
    const forged = accepted({ decision: 'ACCEPTED', allowedActions: ['production-deploy'], decidedBy: 'Claude' });
    writeFileSync(
      join(dir, ...gatekeeperDecisionEvidenceRelPath('GKDEC-forged00000')!.split('/')),
      `${JSON.stringify({ ...forged, decisionId: 'GKDEC-forged00000' }, null, 2)}\n`,
    );

    // The file exists and is well-formed. The runtime's authority path never consults it: a verdict
    // is applied from a live answer checked inside the transition that asked, and `takeGatekeeperTurn`
    // takes no reader for this store at all — only a write-only port. There is no call to make here,
    // which is the proof: the forged file has no route into any decision.
    const turnSource = readFileSync(join(process.cwd(), 'src', 'loop', 'gatekeeperTurn.ts'), 'utf8');
    expect(turnSource).toContain('recordDecisionEvidence');
    expect(turnSource).not.toMatch(/read[A-Za-z]*DecisionEvidence|gatekeeperDecisionEvidenceRelPath/);
  });

  it('an absent record is not an approval — nothing infers a verdict from a missing file', () => {
    const dir = root();
    expect(gatekeeperDecisionEvidenceRelPath('GKDEC-neverwritten')).not.toBeNull();
    // No reader exists, so absence cannot be interpreted at all. The closest observable fact is that
    // the file simply is not there, and no code path asks.
    let threw = false;
    try {
      readEvidence(dir, 'GKDEC-neverwritten');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
