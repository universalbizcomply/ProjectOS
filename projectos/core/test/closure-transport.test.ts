/**
 * The closure request/response contract, judged from every direction it can be wrong.
 *
 * WHAT THIS FILE IS FOR. `checkClosureResponse` is the only thing standing between "a model returned
 * some JSON" and "a record ProjectOS will ask Murad to commit". Every negative below is a way that
 * JSON could be about something else — another project, another phase, another commit, another
 * question, another decider — or could be a technical verdict wearing a closure record's shape.
 *
 * NO NETWORK, NO PROVIDER, NO SPEND. Every value here is a literal.
 */
import { describe, it, expect } from 'vitest';
import {
  CLOSURE_ASK,
  CLOSURE_NOTE_MAX_CHARS,
  CLOSURE_REQUEST_SCHEMA_VERSION,
  CLOSURE_RESPONSE_DECISIONS,
  CLOSURE_DECISION_SCHEMA_VERSION,
  ABSOLUTE_OWNER_ONLY,
  GATEKEEPER_VERDICTS,
  PHASE_CLOSURE_SCOPE,
  STRONG_TIER_ASKS,
  checkClosureDecision,
  checkClosureResponse,
  closureDecisionRecordFrom,
  closureEvidenceDigest,
  closureRequestDigest,
  deriveClosureRequestId,
  gatekeeperRequestDigest,
  isClosureDecisionId,
  type ClosureRequest,
  type ClosureResponseRecord,
  type ClosureResponseExpectations,
} from '../src/index.js';

const PROJECT = 'projectos';
const PHASE = 'PROJECTOS-AUTONOMOUS-CLOSURE-TRANSPORT1A';
const SUBJECT = 'c'.repeat(40);
const OTHER_SUBJECT = 'd'.repeat(40);
const DECIDER = 'ChatGPT';
const OWNER = 'Murad';

function request(over: Partial<ClosureRequest> = {}): ClosureRequest {
  const evidenceDigest = closureEvidenceDigest('validators 141/141; reviews complete; 0 CRITICAL, 0 HIGH');
  return {
    schemaVersion: CLOSURE_REQUEST_SCHEMA_VERSION,
    requestId: deriveClosureRequestId({ projectId: PROJECT, phaseId: PHASE, subjectHead: SUBJECT, evidenceDigest }),
    projectId: PROJECT,
    phaseId: PHASE,
    subjectHead: SUBJECT,
    evidenceDigest,
    expectedDecider: DECIDER,
    scope: PHASE_CLOSURE_SCOPE,
    ...over,
  };
}

function expectations(over: Partial<ClosureResponseExpectations> = {}): ClosureResponseExpectations {
  return {
    projectId: PROJECT,
    phaseId: PHASE,
    scope: PHASE_CLOSURE_SCOPE,
    expectedDecider: DECIDER,
    evidenceSubjectHead: SUBJECT,
    requestDigest: closureRequestDigest(request()),
    alreadyConsumedDecisionIds: [],
    owner: OWNER,
    unresolvedHighIds: [],
    ...over,
  };
}

function response(over: Partial<ClosureResponseRecord> = {}): ClosureResponseRecord {
  return {
    schemaVersion: CLOSURE_DECISION_SCHEMA_VERSION,
    decisionId: 'PROJECTOS-CLOSURE-TRANSPORT1A-CLOSURE-DECISION1A',
    decision: 'close',
    projectId: PROJECT,
    phaseId: PHASE,
    scope: PHASE_CLOSURE_SCOPE,
    decidedBy: DECIDER,
    decidedAt: '2026-09-02T21:00:00+01:00',
    evidenceSubjectHead: SUBJECT,
    requestDigest: closureRequestDigest(request()),
    note: 'accepted for closure: the chain is proven and every protected action remains the owner\'s',
    ownerAcceptedFindings: [],
    ...over,
  };
}

describe('the closure request', () => {
  it('derives the same id for the same question, so a restart buys no second call', () => {
    const digest = closureEvidenceDigest('same evidence');
    const a = deriveClosureRequestId({ projectId: PROJECT, phaseId: PHASE, subjectHead: SUBJECT, evidenceDigest: digest });
    const b = deriveClosureRequestId({ projectId: PROJECT, phaseId: PHASE, subjectHead: SUBJECT, evidenceDigest: digest });
    expect(a).toBe(b);
    expect(a.startsWith('CLREQ-')).toBe(true);
  });

  it('derives a different id for a different subject, because that is a different question', () => {
    const digest = closureEvidenceDigest('same evidence');
    expect(deriveClosureRequestId({ projectId: PROJECT, phaseId: PHASE, subjectHead: SUBJECT, evidenceDigest: digest })).not.toBe(
      deriveClosureRequestId({ projectId: PROJECT, phaseId: PHASE, subjectHead: OTHER_SUBJECT, evidenceDigest: digest }),
    );
  });

  it('digests every field, so changing any one of them is a different question', () => {
    const base = closureRequestDigest(request());
    expect(closureRequestDigest(request({ projectId: 'other' }))).not.toBe(base);
    expect(closureRequestDigest(request({ phaseId: 'OTHER' }))).not.toBe(base);
    expect(closureRequestDigest(request({ subjectHead: OTHER_SUBJECT }))).not.toBe(base);
    expect(closureRequestDigest(request({ expectedDecider: 'Somebody' }))).not.toBe(base);
    expect(closureRequestDigest(request({ evidenceDigest: closureEvidenceDigest('different') }))).not.toBe(base);
  });

  it('is priced under an ask the owner already classified as strong-tier', () => {
    expect(STRONG_TIER_ASKS).toContain(CLOSURE_ASK);
  });
});

describe('a well-formed closure answer', () => {
  it('is accepted, and produces a record that satisfies the closure gate once committed', () => {
    expect(checkClosureResponse(response(), expectations())).toEqual([]);

    const record = closureDecisionRecordFrom(response());
    // The record is judged by the EXISTING gate, with the same expectations the runtime derives.
    expect(
      checkClosureDecision(record, {
        phaseId: PHASE,
        projectId: PROJECT,
        scope: PHASE_CLOSURE_SCOPE,
        expectedDecider: DECIDER,
        evidenceSubjectHead: SUBJECT,
        isCommitted: true,
        alreadyConsumedDecisionIds: [],
      }),
    ).toEqual([]);
  });

  it('copies the authority-bearing values verbatim — nothing is synthesised', () => {
    const answer = response({ decidedAt: '2026-09-02T23:59:59Z', note: 'the authority\'s own words' });
    const record = closureDecisionRecordFrom(answer) as Record<string, unknown>;
    for (const field of ['decisionId', 'decision', 'projectId', 'phaseId', 'scope', 'decidedBy', 'decidedAt', 'evidenceSubjectHead', 'note']) {
      expect(record[field]).toBe((answer as Record<string, unknown>)[field]);
    }
  });
});

describe('an answer about something else is refused', () => {
  const cases: readonly [string, Partial<ClosureResponseRecord>, Partial<ClosureResponseExpectations>, string][] = [
    ['wrong project', { projectId: 'polygo' }, {}, 'is for project'],
    ['wrong phase', { phaseId: 'SOME-OTHER-PHASE1A' }, {}, 'is for phase'],
    ['wrong subject head', { evidenceSubjectHead: OTHER_SUBJECT }, {}, 'an answer about other bytes is stale'],
    ['wrong scope', { scope: 'programme-closure' }, {}, 'is not \'phase-closure\''],
    ['wrong decider', { decidedBy: 'Somebody Else' }, {}, 'is not the plan\'s closure authority'],
    ['the implementer as decider', { decidedBy: 'Claude' }, { expectedDecider: 'Claude' }, 'implementer can never close'],
    ['a stale request digest', { requestDigest: `sha256:${'0'.repeat(64)}` }, {}, 'an answer to a different question'],
    ['no note', { note: '' }, {}, 'not reviewable'],
    ['no decidedAt', { decidedAt: '' }, {}, 'records no decidedAt'],
    ['a bad schema version', { schemaVersion: '2.0.0' }, {}, 'schemaVersion'],
    ['an unusable decision id', { decisionId: 'x' }, {}, 'no usable decisionId'],
  ];

  for (const [name, over, expectOver, fragment] of cases) {
    it(`refuses ${name}`, () => {
      const problems = checkClosureResponse(response(over), expectations(expectOver));
      expect(problems.join(' | ')).toContain(fragment);
    });
  }

  it('refuses an absent answer rather than treating silence as consent', () => {
    expect(checkClosureResponse(null, expectations()).join(' ')).toContain('An absent answer is not a decision to close');
  });

  it('refuses when the closure evidence names no subject at all', () => {
    expect(checkClosureResponse(response(), expectations({ evidenceSubjectHead: null })).join(' ')).toContain(
      'the closure evidence names no subject',
    );
  });

  it('refuses when the plan records no closure delegate, rather than matching an empty string', () => {
    const problems = checkClosureResponse(response({ decidedBy: '' }), expectations({ expectedDecider: '' }));
    expect(problems.join(' ')).toContain('records no decidedBy');
    expect(problems.join(' ')).not.toContain('is not the plan\'s closure authority \'\'');
  });
});

describe('replay and spent answers are refused', () => {
  it('refuses a decision id this phase has already consumed', () => {
    const problems = checkClosureResponse(
      response(),
      expectations({ alreadyConsumedDecisionIds: ['PROJECTOS-CLOSURE-TRANSPORT1A-CLOSURE-DECISION1A'] }),
    );
    expect(problems.join(' ')).toContain('already consumed for this phase and cannot be replayed');
  });

  it('refuses an answer that arrives already carrying a consumption marker', () => {
    const spent = { ...response(), consumedAt: '2026-09-02T20:00:00Z' } as ClosureResponseRecord;
    expect(checkClosureResponse(spent, expectations()).join(' ')).toContain('spent decision rather than an answer');
  });
});

describe('a technical verdict can never masquerade as a closure decision', () => {
  it('refuses every gatekeeper verdict as a closure decision', () => {
    for (const verdict of GATEKEEPER_VERDICTS) {
      const problems = checkClosureResponse(response({ decision: verdict }), expectations());
      expect(problems.join(' ')).toContain('is not one of: close, do-not-close, awaiting-owner');
    }
  });

  it('keeps the two vocabularies disjoint', () => {
    for (const d of CLOSURE_RESPONSE_DECISIONS) {
      expect(GATEKEEPER_VERDICTS as readonly string[]).not.toContain(d);
    }
  });

  it('refuses a whole technical decision record fed in as a closure answer, on several grounds', () => {
    const technical = {
      schemaVersion: '1.0.0',
      decisionId: 'GKDEC-GKREQ-abcdef0123456789abcdef01',
      projectId: PROJECT,
      phaseId: PHASE,
      subjectCommit: SUBJECT,
      requestDigest: gatekeeperRequestDigest({
        schemaVersion: '1.0.0',
        requestId: 'GKREQ-abcdef0123456789abcdef01',
        projectId: PROJECT,
        phaseId: PHASE,
        subjectCommit: SUBJECT,
        ask: 'evidence-review',
        evidenceDigests: [closureEvidenceDigest('x')],
        ownerOnlyActions: ['commit'],
      }),
      decision: 'APPROVED_FOR_CLOSURE',
      allowedActions: [],
      forbiddenActions: [],
      ownerApprovalRequired: true,
      reason: 'looks closable',
      decidedBy: DECIDER,
      decidedAt: '2026-09-02T21:00:00+01:00',
    } as unknown as ClosureResponseRecord;

    const problems = checkClosureResponse(technical, expectations());
    // Not one refusal but several independent ones: the verdict, the scope, the subject binding,
    // the request digest, the note and the acceptance field.
    expect(problems.length).toBeGreaterThanOrEqual(4);
    expect(problems.join(' | ')).toContain('is not one of: close, do-not-close, awaiting-owner');
    expect(problems.join(' | ')).toContain('is not \'phase-closure\'');
    expect(problems.join(' | ')).toContain('names no valid evidence subject commit');
  });

  it('and a closure answer is refused by the technical checker in the same way', () => {
    // The symmetry matters: neither record can be smuggled onto the other's path.
    const asDecision = closureDecisionRecordFrom(response());
    expect(
      checkClosureDecision(asDecision, {
        phaseId: PHASE,
        projectId: PROJECT,
        scope: PHASE_CLOSURE_SCOPE,
        expectedDecider: DECIDER,
        evidenceSubjectHead: SUBJECT,
        isCommitted: false,
        alreadyConsumedDecisionIds: [],
      }).join(' '),
    ).toContain('the decision is not committed');
  });
});

describe('the closure authority may not author the owner\'s acceptance', () => {
  it('refuses a non-empty ownerAcceptedFindings', () => {
    const problems = checkClosureResponse(
      response({
        ownerAcceptedFindings: [
          { findingId: 'H-1', severity: 'HIGH', acceptedBy: OWNER, phaseId: PHASE, evidenceSubjectHead: SUBJECT, scope: 'phase-closure' },
        ],
      }),
      expectations({ unresolvedHighIds: ['H-1'] }),
    );
    expect(problems.join(' ')).toContain('may not author one on the owner\'s behalf');
  });

  it('requires the field to be present, so "nothing carried" is said rather than inferred', () => {
    const without = { ...response() } as Record<string, unknown>;
    delete without['ownerAcceptedFindings'];
    expect(checkClosureResponse(without as ClosureResponseRecord, expectations()).join(' ')).toContain(
      'does not state ownerAcceptedFindings',
    );
  });
});

describe('the shared decision-id predicate', () => {
  it('is the same rule the closure gate applies', () => {
    expect(isClosureDecisionId('A-VALID-DECISION-ID')).toBe(true);
    expect(isClosureDecisionId('short')).toBe(false);
    expect(isClosureDecisionId('has spaces in it')).toBe(false);
  });
});

describe('closure remains absolutely owner-only', () => {
  it('is still in the list no delegation, condition or decision can subtract from', () => {
    expect(ABSOLUTE_OWNER_ONLY as readonly string[]).toContain(PHASE_CLOSURE_SCOPE);
  });

  it('gives the closure answer no field through which any action could be granted', () => {
    const answer = response() as Record<string, unknown>;
    for (const grantShaped of ['allowedActions', 'forbiddenActions', 'ownerApprovalRequired', 'nextClaudeInstruction']) {
      expect(answer[grantShaped]).toBeUndefined();
    }
    // …and the record built from it carries none either.
    const record = closureDecisionRecordFrom(response()) as Record<string, unknown>;
    for (const grantShaped of ['allowedActions', 'forbiddenActions', 'ownerApprovalRequired']) {
      expect(record[grantShaped]).toBeUndefined();
    }
  });
});

describe('the free text a human is asked to read', () => {
  const BIDI = String.fromCodePoint(0x202e);
  const ISOLATE = String.fromCodePoint(0x2066);
  const ZWSP = String.fromCodePoint(0x200b);
  const BOM = String.fromCodePoint(0xfeff);

  it('REFUSES a note carrying a bidirectional override, rather than stripping it', () => {
    const problems = checkClosureResponse(response({ note: `accepted ${BIDI} for closure` }), expectations());
    expect(problems.join(' ')).toContain('bidirectional or invisible formatting character');
    expect(problems.join(' ')).toContain('refused rather than stripped');
  });

  it('refuses every reordering and invisible character class, not just the famous one', () => {
    for (const ch of [BIDI, ISOLATE, ZWSP, BOM]) {
      expect(checkClosureResponse(response({ note: `a${ch}b` }), expectations()).join(' ')).toContain(
        'bidirectional or invisible',
      );
    }
  });

  it('refuses a control character in the note', () => {
    const problems = checkClosureResponse(response({ note: `bell${String.fromCharCode(7)}here` }), expectations());
    expect(problems.join(' ')).toContain('control character');
  });

  it('allows ordinary punctuation, newlines and non-Latin text', () => {
    const note = ['accepted — 承認済み', 'second line: "quoted", (parenthesised) & fine.'].join(String.fromCharCode(10));
    expect(checkClosureResponse(response({ note }), expectations())).toEqual([]);
  });

  it('refuses an over-long note rather than truncating what the authority said', () => {
    const problems = checkClosureResponse(
      response({ note: 'x'.repeat(CLOSURE_NOTE_MAX_CHARS + 1) }),
      expectations(),
    );
    expect(problems.join(' ')).toContain('refused rather than truncated');
  });

  it('applies the same rule to decidedAt and decisionId', () => {
    expect(checkClosureResponse(response({ decidedAt: `2026${BIDI}-09-02` }), expectations()).join(' ')).toContain(
      'decidedAt contains',
    );
    expect(
      checkClosureResponse(response({ decisionId: `GOOD${ZWSP}-DECISION1A` }), expectations()).join(' '),
    ).toContain('decisionId');
  });
});
