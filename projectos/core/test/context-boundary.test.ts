import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from '../src/index.js';
import { applyCompaction, contextPressure, estimateThreadTokens, noteContextCompaction, planCompaction, recordContextUsage, renderContextPrompt, renderSummaryInput } from '../src/context/index.js';
import { AGENT, accountOf, accountsFor, agentTurn, decisionOf, draftFor, kernelTurn, longTurns, must, ownerTurn, threadOf } from './context-support.js';

interface Mutation {
  readonly name: string;
  readonly rule: string;
  readonly rel: string;
}
interface ContextValidator {
  readonly MUTATIONS: readonly Mutation[];
  readonly RULE_NAMES: Readonly<Record<string, string>>;
  readonly readAll: () => Readonly<Record<string, string>>;
  readonly applyMutation: (text: string, mutation: Mutation) => string;
  readonly textProblems: (raw: Readonly<Record<string, string>>) => readonly (readonly [string, string])[];
}

const validator = createRequire(import.meta.url)('../../validators/val-projectos-port-context1a.cjs') as ContextValidator;
const raw = validator.readAll();
const TEXT_RULES = ['PX-15', 'PX-16', 'PX-17', 'PX-18'];

const scenario = () => {
  const accounts = accountsFor();
  const account = accountOf(accounts);
  const thread = threadOf([kernelTurn('s1', 'The kernel prompt.'), ...longTurns('old', 8), ownerTurn('u1', 'Finish.'), agentTurn('a1', 'Working.')], [decisionOf('Keep the owner floor.')]);
  const plan = must(planCompaction(thread, account));
  const { thread: after, record } = must(applyCompaction(thread, account, draftFor(thread, 'A plain account of the work.')));
  const noted = must(noteContextCompaction(accounts, AGENT));
  const read = must(recordContextUsage(noted, { agentId: AGENT, promptTokens: 2_000, estimatedTokens: estimateThreadTokens(after) }));
  return {
    input: renderSummaryInput(plan),
    prompt: must(renderContextPrompt(after)),
    record,
    pressure: must(contextPressure(read, AGENT, estimateThreadTokens(after))),
  };
};

describe('the rules stay pure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('a whole compaction touches no clock, chance, timer or network', () => {
    const trap = (): never => {
      throw new Error('the rules reached outside themselves');
    };
    vi.spyOn(Date, 'now').mockImplementation(trap);
    vi.spyOn(Math, 'random').mockImplementation(trap);
    vi.stubGlobal('fetch', trap);
    vi.stubGlobal('setTimeout', trap);
    vi.stubGlobal('setInterval', trap);
    vi.stubGlobal('queueMicrotask', trap);
    expect(() => scenario()).not.toThrow();
  });

  it('the same input gives the same record and the same prompt', () => {
    expect(scenario()).toEqual(scenario());
  });
});

describe('the core package carries the rules', () => {
  it('exports them from the barrel', () => {
    expect(typeof core.applyCompaction).toBe('function');
    expect(typeof core.contextPressure).toBe('function');
    expect(typeof core.renderContextPrompt).toBe('function');
    expect(typeof core.redactSecrets).toBe('function');
  });
});

describe('the rules the validator reads from the text', () => {
  it('finds nothing wrong with the real tree: the positive control', () => {
    expect(validator.textProblems(raw).map(([, message]) => message)).toEqual([]);
  });

  it.each(TEXT_RULES)('%s has mutations to answer for', (rule) => {
    expect(validator.MUTATIONS.filter((mutation) => mutation.rule === rule).length).toBeGreaterThanOrEqual(5);
    expect(validator.RULE_NAMES[rule]).toBeDefined();
  });

  it.each(validator.MUTATIONS.filter((mutation) => TEXT_RULES.includes(mutation.rule)).map((mutation) => [mutation.rule, mutation.name, mutation] as const))('%s fires on %s', (rule, _, mutation) => {
    const changed = { ...raw, [mutation.rel]: validator.applyMutation(raw[mutation.rel] ?? '', mutation) };
    expect(validator.textProblems(changed).map(([fired]) => fired)).toContain(rule);
  });
});
