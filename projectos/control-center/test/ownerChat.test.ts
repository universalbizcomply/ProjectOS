import { describe, it, expect } from 'vitest';
import { answerOwnerQuestion, rankIntents } from '../src/owner/ownerChatModel';
import { PROJECTOS_V3, DEMO_ACME } from '../src/owner/ownerSnapshot';
import { completionPercent } from '../src/owner/ownerModel';

describe('answerOwnerQuestion — intents', () => {
  it('greets', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'hi there');
    expect(a.intent).toBe('greeting');
  });

  it('explains its own capabilities on help', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'what can you help me with?');
    expect(a.intent).toBe('help');
    expect(a.answer.toLowerCase()).toContain('you can ask about');
  });

  it('reports the plan status', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'What is the plan status?');
    expect(a.intent).toBe('status');
    expect(a.answer).toContain(PROJECTOS_V3.planStatus);
  });

  it('answers progress with the completion label', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'how far along are we?');
    expect(a.intent).toBe('progress');
    expect(a.answer).toContain(`${completionPercent(PROJECTOS_V3.acceptedPhaseCount, PROJECTOS_V3.totalPhaseCount)}%`);
  });

  it('reports no decisions when none are pending', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'what decisions need me?');
    expect(a.intent).toBe('decisions');
    expect(a.answer.toLowerCase()).toContain('nothing is waiting');
  });

  it('lists pending decisions for a project that has them', () => {
    const a = answerOwnerQuestion(DEMO_ACME, 'is anything waiting on me to approve?');
    expect(a.intent).toBe('decisions');
    expect(a.answer).toContain(DEMO_ACME.decisionsRequired[0]!.title);
  });

  it('surfaces risks', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'is there anything to worry about?');
    expect(a.intent).toBe('risks');
    expect(a.answer.toLowerCase()).toContain('risk');
  });

  it('surfaces blockers when present and says clear when not', () => {
    expect(answerOwnerQuestion(DEMO_ACME, 'why is this blocked?').intent).toBe('blockers');
    // PROJECTOS_V3 now surfaces a real canonical blocker (PolyGo 14–16); the "clear" case uses a no-blocker model.
    const clear = answerOwnerQuestion({ ...PROJECTOS_V3, blockers: [] }, 'is anything blocked?');
    expect(clear.answer.toLowerCase()).toContain('nothing is blocked');
  });

  it('gives the next safe action', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'what should I do next?');
    expect(a.intent).toBe('next');
    expect(a.answer).toContain(PROJECTOS_V3.nextSafeAction);
  });

  it('reports the phase / where-you-are', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'which phase are we on?');
    expect(a.intent).toBe('phase');
    expect(a.answer).toContain(PROJECTOS_V3.programme);
  });

  it('explains owner-only actions cannot be performed for the owner', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'can you do it for me?');
    expect(a.intent).toBe('restricted');
    expect(a.answer.toLowerCase()).toContain('only you can authorise');
  });

  it('reports the safety state', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'is it safe? any secret or api used?');
    expect(a.intent).toBe('safety');
    expect(a.answer.toLowerCase()).toContain('no ai api used');
  });

  it('falls back for an unrecognised question without inventing facts', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'tell me a joke about penguins');
    expect(a.intent).toBe('unknown');
    expect(a.answer.toLowerCase()).toContain('current status');
  });
});

describe('answerOwnerQuestion — natural language robustness', () => {
  it('understands varied phrasings for status', () => {
    for (const q of ['where do things stand?', 'give me a summary', 'how are things going?']) {
      expect(answerOwnerQuestion(PROJECTOS_V3, q).intent).toBe('status');
    }
  });

  it('does not misclassify "deliver" as safety (no substring false-positive)', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'Can we deliver the next milestone?');
    expect(a.intent).not.toBe('safety');
    expect(['next', 'progress']).toContain(a.intent);
  });

  it('answers a compound question about two content intents', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'what is the plan status and how far along are we?');
    expect(a.matchedIntents).toContain('status');
    expect(a.matchedIntents).toContain('progress');
    expect(a.answer).toContain(PROJECTOS_V3.planStatus);
    expect(a.answer).toContain(`${completionPercent(PROJECTOS_V3.acceptedPhaseCount, PROJECTOS_V3.totalPhaseCount)}%`);
  });

  it('ranks the strongest intent first', () => {
    const ranked = rankIntents('what decisions are waiting on me to approve?');
    expect(ranked[0]).toBe('decisions');
  });

  it('returns no intents for an empty question', () => {
    expect(rankIntents('   ')).toEqual([]);
  });
});

describe('answerOwnerQuestion — determinism & suggestions', () => {
  it('is deterministic — same model + question yields the same answer', () => {
    const q = 'what is the plan status and progress?';
    expect(answerOwnerQuestion(PROJECTOS_V3, q)).toEqual(answerOwnerQuestion(PROJECTOS_V3, q));
  });

  it('always returns stable suggestions', () => {
    expect(answerOwnerQuestion(PROJECTOS_V3, '').suggestions.length).toBeGreaterThan(0);
  });
});


/**
 * THE QUESTION THAT WAS ANSWERED WRONG. Asked on the installed application: "how much has the
 * reviewer cost me so far". It came back "0 of 1 phases accepted · 0%. Currently on
 * PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A." -- true, confident, and about something else entirely.
 * 'how much' was a PROGRESS phrase and no cost intent existed, so a cost question could only ever
 * land on the nearest scoring neighbour. Answering the wrong question is worse than declining,
 * because the owner has no way to tell it happened.
 */
describe('answerOwnerQuestion — reviewer cost', () => {
  const gk = {
    configured: true,
    budget: {
      status: 'OK' as const,
      spentThisMonthMicroUsd: 410_000,
      remainingMicroUsd: 4_590_000,
      warnAtMicroUsd: 2_000_000,
      hardStopAtMicroUsd: 5_000_000,
    },
    spentThisPhaseMicroUsd: 410_000,
    spentThisProjectMicroUsd: 410_000,
    callCount: 15,
    lastCall: { requestId: 'GKREQ-1', model: 'gpt-5.6-terra', at: '2026-08-26T00:30:00.000Z', costMicroUsd: 62_079 },
  };

  it('routes the exact question that was misrouted, and quotes the ledger', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'how much has the reviewer cost me so far', gk);
    expect(a.intent).toBe('cost');
    expect(a.answer).toContain('$0.41');
    expect(a.answer).toContain('15 calls');
    // The specific untruth: it must not answer with phase progress.
    expect(a.answer).not.toContain('phases accepted');
  });

  it('still reads a genuine progress question as progress', () => {
    expect(answerOwnerQuestion(PROJECTOS_V3, 'how much progress have we made?', gk).intent).toBe('progress');
    expect(answerOwnerQuestion(PROJECTOS_V3, 'how far along are we?', gk).intent).toBe('progress');
  });

  it('reports the budget ceiling and the last call', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'what is left in the budget?', gk);
    expect(a.intent).toBe('cost');
    expect(a.answer).toContain('$4.59');
    expect(a.answer).toContain('gpt-5.6-terra');
  });

  it('declines rather than quoting a figure when the runtime is not reporting', () => {
    const a = answerOwnerQuestion(PROJECTOS_V3, 'how much have we spent?', null);
    expect(a.intent).toBe('cost');
    expect(a.answer).not.toMatch(/\$\d/);
    expect(a.answer.toLowerCase()).toContain('will not quote');
  });

  it('says nothing was spent when the reviewer was never contacted', () => {
    const never = { ...gk, callCount: 0, lastCall: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0 };
    const a = answerOwnerQuestion(PROJECTOS_V3, 'what has this cost?', never);
    expect(a.answer.toLowerCase()).toContain('never been contacted');
  });
});
