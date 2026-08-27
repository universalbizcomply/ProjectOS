/**
 * A PAID PROVIDER ANSWER MUST SURVIVE ITS OWN VALIDATION FAILURE.
 *
 * THE INCIDENT. The first live plan-authoring call was dispatched, answered and settled — 34,761
 * input tokens, 1,138 output tokens, 54,831 micro-USD. It then failed a check AFTER settlement, and
 * the port returned a refusal and dropped the response body. Nothing persisted the reply anywhere,
 * so the material was unrecoverable and even WHICH check had failed was unrecorded. The money was
 * spent and the only trace was a ledger row saying so.
 *
 * These tests drive the real `brokeredAuthorPort` with a transport that returns a canned body, so
 * every "dispatch" here is a function returning a string. Nothing reaches a network.
 *
 * THE FOUR PROPERTIES. Every paid exit leaves a record; the record is redacted and bounded; a record
 * that cannot be written is REPORTED rather than swallowed; and evidence never turns a refusal into
 * a success.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { brokeredAuthorPort, type AuthorRequest } from '../src/planAuthoring.js';
import {
  buildAuthoringAttemptEvidence,
  writeAuthoringAttemptEvidence,
  redactSecrets,
  containsSecret,
  normaliseEscapes,
  authoringEvidenceRelPath,
  MAX_EVIDENCE_EXCERPT_CHARS,
  MAX_EVIDENCE_BYTES,
  type EvidenceInput,
} from '../src/authoringEvidence.js';
import type { System } from '../src/system.js';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

const REQUEST_ID = 'PAREQ-1088a5aef8720e22e13ccf32';
const OBJECTIVE = 'Create the smallest credible read-only plan to verify programme status.';

function workspace(): { root: string; sys: System } {
  const root = mkdtempSync(join(tmpdir(), 'projectos-evidence-')).replace(/\\/g, '/');
  created.push(root);
  const sys = {
    cwd: () => root,
    now: () => '2026-08-27T17:31:09.072Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: () => ({ code: 1, stdout: '', stderr: '' }),
  } as unknown as System;
  return { root, sys };
}

const request: AuthorRequest = {
  objective: OBJECTIVE,
  projectId: 'projectos',
  repository: 'universalbizcomply/ProjectOS',
  contextSourcePaths: ['docs-plan.md'],
  objectiveDigest: 'a'.repeat(64),
  requestId: REQUEST_ID,
};

/** A provider reply with real usage, and whatever output the test wants to have come back. */
function reply(output: unknown, usage = { input_tokens: 34_761, output_tokens: 1_138 }): string {
  return JSON.stringify({
    id: 'resp_abc123',
    usage,
    output:
      output === null
        ? []
        : [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  });
}

/** The port, wired to a transport that answers with `body` and to a real evidence writer. */
function port(root: string, sys: System, body: string, status = 200) {
  const settled: string[] = [];
  const author = brokeredAuthorPort(
    { model: 'gpt-5.6-terra', credentialRef: 'OPENAI_GATEKEEPER_KEY', projectId: 'projectos', governedRoot: root },
    {
      transport: { post: () => ({ kind: 'response' as const, status, body }) },
      settleSpend: (id) => {
        settled.push(id);
        return 54_831;
      },
      now: () => sys.now(),
      recordAttempt: (input) => writeAuthoringAttemptEvidence(sys, root, buildAuthoringAttemptEvidence(input)),
    },
  );
  return { author, settled };
}

function recordOn(root: string): Record<string, unknown> {
  const rel = authoringEvidenceRelPath(REQUEST_ID)!;
  return JSON.parse(readFileSync(join(root, rel), 'utf8')) as Record<string, unknown>;
}

describe('every paid exit leaves a record', () => {
  test('material that fails the plan contract is kept, with the candidate that failed it', () => {
    const { root, sys } = workspace();
    // Structurally a plan, and missing the fields the contract requires.
    const { author } = port(root, sys, reply({ businessVision: 'a reliable ordering system' }));

    const outcome = author.author(request);

    expect(outcome.ok).toBe(false);
    const record = recordOn(root);
    expect(record['requestId']).toBe(REQUEST_ID);
    expect(record['finalOutcome']).toBe('refused');
    expect(record['refusalCode']).toBe('AUTHORED_MATERIAL_INVALID');
    expect(record['parseOutcome']).toBe('parsed');
    expect(record['structuredOutcome']).toBe('extracted');
    expect(record['validationOutcome']).toBe('invalid');
    expect((record['validationProblems'] as string[]).length).toBeGreaterThan(0);
    // THE MONEY IS IN THE RECORD, because that is the question the owner will ask first.
    expect(record['usage']).toEqual({ inputTokens: 34_761, cachedInputTokens: 0, outputTokens: 1_138 });
    expect(record['settledCostMicroUsd']).toBe(54_831);
    expect(record['providerResponseId']).toBe('resp_abc123');
    expect(record['model']).toBe('gpt-5.6-terra');
    // AND THE MATERIAL IS RECOVERABLE BY HAND — the whole point.
    expect(String(record['structuredCandidate'])).toContain('a reliable ordering system');
    expect(String(record['responseSha256'])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('a reply with no structured material at all is kept too', () => {
    const { root, sys } = workspace();
    const { author } = port(root, sys, reply(null));

    const outcome = author.author(request);

    expect(outcome.ok).toBe(false);
    const record = recordOn(root);
    expect(record['refusalCode']).toBe('AUTHOR_REFUSED');
    expect(record['structuredOutcome']).toBe('absent-or-refusal');
    expect(record['validationOutcome']).toBe('not-reached');
    // Nothing is invented: there was no candidate, so none is claimed.
    expect(record['structuredCandidate']).toBeNull();
  });

  test('a reply that is not JSON is kept, with its bytes identified', () => {
    const { root, sys } = workspace();
    const { author } = port(root, sys, 'this is not json at all');

    const outcome = author.author(request);

    expect(outcome.ok).toBe(false);
    const record = recordOn(root);
    expect(record['refusalCode']).toBe('AUTHOR_MALFORMED');
    expect(record['parseOutcome']).toBe('not-json');
    expect(record['responseExcerpt']).toContain('not json');
    expect(record['responseBytes']).toBe('this is not json at all'.length);
  });

  test('an HTTP failure is kept, and settles nothing', () => {
    const { root, sys } = workspace();
    const { author, settled } = port(root, sys, '{"error":"upstream"}', 500);

    const outcome = author.author(request);

    expect(outcome.ok).toBe(false);
    const record = recordOn(root);
    expect(record['httpStatus']).toBe(500);
    expect(record['refusalCode']).toBe('AUTHOR_UNAVAILABLE');
    // A non-2xx is not settled, so the record must not claim a cost it never incurred.
    expect(settled).toEqual([]);
    expect(record['settledCostMicroUsd']).toBeNull();
  });

  test('a call that never reached the provider leaves NO record, because it was not a dispatch', () => {
    const { root, sys } = workspace();
    const author = brokeredAuthorPort(
      { model: 'gpt-5.6-terra', credentialRef: 'OPENAI_GATEKEEPER_KEY', projectId: 'projectos', governedRoot: root },
      {
        transport: { post: () => ({ kind: 'transport-error' as const, detail: 'the gatekeeper transport failed' }) },
        now: () => sys.now(),
        recordAttempt: (input) => writeAuthoringAttemptEvidence(sys, root, buildAuthoringAttemptEvidence(input)),
      },
    );

    const outcome = author.author(request);

    expect(outcome.ok).toBe(false);
    // A record asserting a dispatch this side cannot prove would be a guess written into a governed
    // repository. The broker reports pre-dispatch refusals down this same channel.
    expect(existsSync(join(root, '.projectops/evidence/authoring'))).toBe(false);
  });

  test('success writes NO record — the draft is the durable artefact, not a second copy', () => {
    const { root, sys } = workspace();
    // The contract's own vocabulary, matching the accepted fixture in planAuthoring.test.ts.
    const complete = {
      businessVision: 'ProjectOS governance over this repository is demonstrably working.',
      definitionOfComplete: 'One bounded read-only governance proof has been run and its evidence recorded.',
      successStandard: 'The proof completes without modifying any product source file.',
      approvedScopeCandidates: ['read-only inspection of governance records', 'recording proof evidence'],
      excludedScopeCandidates: ['modifying product source', 'the existing payments programme'],
      environmentCandidates: [{ environmentId: 'local', productionFreeze: true }],
      phaseCandidates: [
        {
          phaseId: 'ACME-GOVPROOF1A',
          purpose: 'Run one bounded read-only governance proof and record its evidence.',
          scope: 'Governance records only. No product source is read for modification and none is written.',
          acceptanceCriteria: [
            'the proof runs to completion',
            'no product source file is modified',
            'evidence is recorded against this phase',
          ],
          dependencies: [],
          riskLevel: 'low',
          autonomyLevel: 'read-only',
          expectedValidators: ['validate-all'],
          requiredReviews: ['code-review'],
          requiredBrowserProof: false,
          ownerGates: ['approve phase closure'],
        },
      ],
      unresolvedUnknowns: [],
      ownerDecisionsRequired: [],
    };
    const { author } = port(root, sys, reply(complete));

    const outcome = author.author(request);

    expect(outcome.ok).toBe(true);
    expect(outcome.ok ? outcome.material.phaseCandidates : []).toHaveLength(1);
    expect(existsSync(join(root, '.projectops/evidence/authoring'))).toBe(false);
  });
});

describe('the record is safe to write into a governed repository', () => {
  test('a provider key echoed in the reply is redacted, not committed', () => {
    const { root, sys } = workspace();
    const leaked = 'sk-proj-' + 'A'.repeat(40);
    const { author } = port(root, sys, JSON.stringify({ id: 'r1', usage: {}, note: 'your key is ' + leaked }));

    author.author(request);

    const raw = readFileSync(join(root, authoringEvidenceRelPath(REQUEST_ID)!), 'utf8');
    expect(raw).not.toContain(leaked);
    expect(raw).toContain('[REDACTED]');
  });

  test('a named credential assignment is redacted by the other vocabulary', () => {
    expect(redactSecrets('OPENAI_API_KEY: hunter2-not-a-shape')).toContain('<redacted>');
    expect(redactSecrets('OPENAI_API_KEY: hunter2-not-a-shape')).not.toContain('hunter2');
  });

  test('every provider family is recognised, and ordinary text is not', () => {
    for (const shape of [
      'sk-proj-' + 'A'.repeat(30),
      'sk-svcacct-' + 'B'.repeat(30),
      'sk-admin-' + 'C'.repeat(30),
      'sk-ant-' + 'D'.repeat(30),
      'sk-' + 'E'.repeat(45),
    ]) {
      expect(containsSecret(shape)).toBe(true);
      expect(redactSecrets(shape)).toBe('[REDACTED]');
    }
    for (const benign of ['sk-short', 'a normal sentence about a plan', 'phase PROJECTOS-RECOVERY1A']) {
      expect(containsSecret(benign)).toBe(false);
    }
  });

  test('a huge reply is bounded rather than archived', () => {
    const { root, sys } = workspace();
    const { author } = port(root, sys, JSON.stringify({ id: 'r1', usage: {}, filler: 'x'.repeat(400_000) }));

    author.author(request);

    const record = recordOn(root);
    expect(String(record['responseExcerpt']).length).toBeLessThanOrEqual(MAX_EVIDENCE_EXCERPT_CHARS + 60);
    // The digest still identifies the WHOLE reply, even though only a sample is kept.
    expect(record['responseBytes']).toBeGreaterThan(400_000);
    const bytes = readFileSync(join(root, authoringEvidenceRelPath(REQUEST_ID)!), 'utf8').length;
    expect(bytes).toBeLessThanOrEqual(MAX_EVIDENCE_BYTES);
    // AND IT IS BOUNDED IN TIME AS WELL AS SIZE. The named-value redactor backtracks quadratically
    // over a long run of word characters, so redacting the whole reply before trimming it took two
    // MINUTES for this fixture — inside a command whose own backstop is five. Trimming first made it
    // 171ms. This budget is the regression guard: it is ~30x the honest cost and ~1/40th the defect's.
  }, 5_000);

  test('a request id that is not one cannot become a path', () => {
    expect(authoringEvidenceRelPath('../../etc/passwd')).toBeNull();
    expect(authoringEvidenceRelPath('PAREQ-not-hex')).toBeNull();
    expect(authoringEvidenceRelPath('GKREQ-1088a5aef8720e22e13ccf32')).toBeNull();
    expect(authoringEvidenceRelPath(REQUEST_ID)).toBe('.projectops/evidence/authoring/' + REQUEST_ID + '.json');
  });
});

describe('evidence changes what is known, never what was decided', () => {
  test('a record that cannot be written is REPORTED in the refusal itself', () => {
    const { root, sys } = workspace();
    const author = brokeredAuthorPort(
      { model: 'gpt-5.6-terra', credentialRef: 'OPENAI_GATEKEEPER_KEY', projectId: 'projectos', governedRoot: root },
      {
        transport: { post: () => ({ kind: 'response' as const, status: 200, body: reply(null) }) },
        settleSpend: () => 54_831,
        now: () => sys.now(),
        recordAttempt: () => ({ ok: false, problem: 'the disk is full' }),
      },
    );

    const outcome = author.author(request);

    expect(outcome.ok).toBe(false);
    const detail = outcome.ok ? '' : outcome.detail;
    // After real money has been spent, "there is no record and nobody said so" must be impossible.
    expect(detail).toContain('paid for and its record was NOT kept');
    expect(detail).toContain('the disk is full');
    // And the original reason survives alongside it.
    expect(detail).toContain('no structured plan material');
  });

  test('a successfully written record does not rescue a refusal', () => {
    const { root, sys } = workspace();
    const { author } = port(root, sys, reply(null));

    const outcome = author.author(request);

    expect(outcome.ok).toBe(false);
    expect(existsSync(join(root, authoringEvidenceRelPath(REQUEST_ID)!))).toBe(true);
  });

  test('a record still carrying a secret after redaction is refused rather than written', () => {
    const { root, sys } = workspace();
    // A record whose own field is a live shape, constructed directly to defeat the excerpt redaction.
    const input = {
      requestId: REQUEST_ID,
      projectId: 'projectos',
      objectiveDigest: 'a'.repeat(64),
      // The model field is not redacted — it is meant to be a model name, not a place for a key.
      model: 'sk-ant-' + 'Z'.repeat(30),
      dispatchedAt: '2026-08-27T17:31:00Z',
      settledAt: null,
      providerResponseId: null,
      httpStatus: 200,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      settledCostMicroUsd: null,
      parseOutcome: 'parsed',
      structuredOutcome: 'absent-or-refusal',
      validationOutcome: 'not-reached',
      validationProblems: [],
      finalOutcome: 'refused',
      refusalCode: 'AUTHOR_REFUSED',
      refusalDetail: null,
      responseBody: '{}',
      structuredCandidate: null,
    } as EvidenceInput;

    const written = writeAuthoringAttemptEvidence(sys, root, buildAuthoringAttemptEvidence(input));

    expect(written.ok).toBe(false);
    expect(written.ok === false ? written.problem : '').toContain('credential-shaped');
    expect(existsSync(join(root, authoringEvidenceRelPath(REQUEST_ID)!))).toBe(false);
  });
});

describe('a reply cannot hide a secret in its own encoding', () => {
  /** The same key, written the way JSON permits any string character to be written. */
  const BS = String.fromCharCode(92);
  const escapeAll = (text: string): string =>
    [...text].map((c) => BS + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');

  test('THE BYPASS: an escaped provider key is recognised, not written through', () => {
    const secret = 'sk-ant-' + 'ABCDEFGHIJ1234567890xyzLIVEKEY';
    const body = '{"id":"resp_1","note":"leaked: ' + escapeAll(secret) + '"}';

    // The literal key is genuinely absent from the bytes — that is what defeated the old scan.
    expect(body.includes(secret)).toBe(false);
    expect(normaliseEscapes(body)).toContain(secret);
    expect(containsSecret(body)).toBe(true);
    expect(redactSecrets(body)).toContain('[REDACTED]');
    expect(redactSecrets(body)).not.toContain(secret);
  });

  test('and it does not reach the written record, in any recoverable form', () => {
    const { root, sys } = workspace();
    const secret = 'sk-proj-' + 'ZYXWVUTSRQ0987654321abcLIVE';
    const { author } = port(root, sys, '{"id":"r","usage":{},"note":"' + escapeAll(secret) + '"}');

    author.author(request);

    const raw = readFileSync(join(root, authoringEvidenceRelPath(REQUEST_ID)!), 'utf8');
    expect(raw).not.toContain(secret);
    // Nor recoverable by decoding what WAS written.
    expect(normaliseEscapes(raw)).not.toContain(secret);
    const excerpt = JSON.parse(raw).responseExcerpt as string;
    expect(excerpt).toContain('[REDACTED]');
  });

  test('a doubly-escaped secret is unwrapped too', () => {
    const secret = 'sk-admin-' + 'QQQQQQQQQQ1111111111wwwLIVE';
    const once = escapeAll(secret);
    const twice = [...once].map((c) => (c === BS ? BS + 'u005c' : c)).join('');
    expect(containsSecret(twice)).toBe(true);
  });

  test('unescaping is bounded, so a reply cannot expand forever', () => {
    // Not a secret, just deeply escaped: it must terminate and stay a string.
    const deep = (BS + 'u005c').repeat(2_000) + 'u0073';
    const out = normaliseEscapes(deep);
    expect(typeof out).toBe('string');
    expect(out.length).toBeLessThanOrEqual(deep.length);
  });

  test('ordinary escaped text is still readable, not mangled into a false positive', () => {
    const body = '{"note":"caf' + BS + 'u00e9 and a plan"}';
    expect(containsSecret(body)).toBe(false);
    expect(normaliseEscapes(body)).toContain('caf\u00e9');
  });
});

describe('the bound is measured in the unit it claims', () => {
  test('a record is refused on REAL bytes, not UTF-16 units', () => {
    const { root, sys } = workspace();
    // Characters whose UTF-8 encoding is three bytes each: .length would pass, byte length must not.
    const wide = '\u4e2d'.repeat(30_000);
    const { author } = port(root, sys, JSON.stringify({ id: 'r', usage: {}, filler: wide }));

    author.author(request);

    const path = join(root, authoringEvidenceRelPath(REQUEST_ID)!);
    if (existsSync(path)) {
      expect(Buffer.byteLength(readFileSync(path, 'utf8'), 'utf8')).toBeLessThanOrEqual(MAX_EVIDENCE_BYTES);
    }
  });

  test('responseBytes reports bytes, not code units', () => {
    const { root, sys } = workspace();
    const body = '{"id":"r","usage":{},"n":"\u4e2d\u4e2d\u4e2d"}';
    const { author } = port(root, sys, body);

    author.author(request);

    const record = recordOn(root);
    expect(record['responseBytes']).toBe(Buffer.byteLength(body, 'utf8'));
    expect(record['responseBytes']).toBeGreaterThan(body.length);
  });
});

describe('the last paid exit that used to leave nothing', () => {
  test('material carrying a credential shape is a PAID refusal, with a record', () => {
    const { root, sys } = workspace();
    const complete = {
      businessVision: 'ProjectOS governance over this repository is demonstrably working.',
      definitionOfComplete: 'One bounded read-only governance proof has been run and its evidence recorded.',
      successStandard: 'The proof completes without modifying any product source file.',
      approvedScopeCandidates: ['read-only inspection of governance records'],
      excludedScopeCandidates: ['modifying product source'],
      environmentCandidates: [{ environmentId: 'local', productionFreeze: true }],
      phaseCandidates: [
        {
          phaseId: 'ACME-GOVPROOF1A',
          // The model emits a key it was never given. Valid against the contract; not storable.
          purpose: 'Run the proof using sk-proj-' + 'AAAAAAAAAABBBBBBBBBBCCCCCCCCCC',
          scope: 'Governance records only.',
          acceptanceCriteria: ['the proof runs to completion'],
          dependencies: [],
          riskLevel: 'low',
          autonomyLevel: 'read-only',
          expectedValidators: ['validate-all'],
          requiredReviews: ['code-review'],
          requiredBrowserProof: false,
          ownerGates: ['approve phase closure'],
        },
      ],
      unresolvedUnknowns: [],
      ownerDecisionsRequired: [],
    };
    const { author } = port(root, sys, reply(complete));

    const outcome = author.author(request);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false ? outcome.code : '').toBe('AUTHORED_MATERIAL_SECRET_SHAPED');
    // THE POINT: it is a paid refusal, so it is recorded — and the record refuses to carry the key.
    const detail = outcome.ok ? '' : outcome.detail;
    const written = existsSync(join(root, authoringEvidenceRelPath(REQUEST_ID)!));
    if (written) {
      const raw = readFileSync(join(root, authoringEvidenceRelPath(REQUEST_ID)!), 'utf8');
      expect(raw).not.toContain('sk-proj-AAAAAAAAAABBBBBBBBBBCCCCCCCCCC');
    } else {
      // Refusing to write a record that would carry a key is the other correct outcome, and it is
      // never silent.
      expect(detail).toContain('record was NOT kept');
    }
  });
});
