import { describe, it, expect } from 'vitest';
import { answerOwnerQuestion, rankIntents } from '../src/owner/ownerChatModel';
import { PROJECTOS_V3, DEMO_ACME } from '../src/owner/ownerSnapshot';

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
    expect(a.answer).toContain('15.8%');
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
    expect(a.answer).toContain('15.8%');
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
