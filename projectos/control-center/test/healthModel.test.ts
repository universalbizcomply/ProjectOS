/**
 * HEALTH MUST NOT INVENT HEALTH.
 *
 * The screen that says "everything is fine" is the one most worth distrusting, so these prove the
 * four ways it could lie and does not:
 *
 *   1. a stored credential is never reported as a working provider;
 *   2. an absent budget is never reported as $0;
 *   3. "could not read" is never reported as "nothing configured";
 *   4. the headline is never better than the worst thing underneath it.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { describe, test, expect } from 'vitest';
import { buildHealthModel } from '../src/ux/healthModel';
import type { GovernedProjection, GovernedState } from '../src/governed/types';

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'polygo',
    projectName: 'PolyGo',
    repository: { repo: 'acme/polygo', localPath: 'C:/dev/polygo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '1.2', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 1, totalPhaseCount: 3, completionPercentage: 33, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: {
      configured: true,
      budget: { status: 'OK', spentThisMonthMicroUsd: 2_000_000, remainingMicroUsd: 8_000_000, warnAtMicroUsd: 8_000_000, hardStopAtMicroUsd: 10_000_000 },
      spentThisPhaseMicroUsd: 500_000,
      spentThisProjectMicroUsd: 2_000_000,
      callCount: 4,
      lastCall: { requestId: 'r1', model: 'strong', at: '2026-08-27T18:00:00.000Z', costMicroUsd: 17_000 },
    },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: 'Continue.',
    observedAt: '2026-08-27T19:59:00.000Z',
    ...over,
  } as GovernedProjection;
}

const conn = (provider: string, status: string) =>
  ({ provider, environment: 'production', credential: 'token', reference: `ProjectOS/polygo/production/${provider}/token`, risk: 'session', status, fingerprint: 'ab12cd34', expiresAt: null }) as never;

const group = (m: ReturnType<typeof buildHealthModel>, id: string) => m.groups.find((g) => g.id === id)!;
const factsText = (m: ReturnType<typeof buildHealthModel>, id: string): string =>
  JSON.stringify(group(m, id));

describe('a stored credential is never a healthy provider', () => {
  test('connectivity says what is on file, and never that a provider is reachable', () => {
    const m = buildHealthModel(projection({
      connections: { available: true, detail: '', connections: [conn('openai', 'STORED'), conn('github', 'STORED')] },
    }));
    const text = factsText(m, 'connectivity');
    expect(text).not.toContain('Connected');
    expect(text).not.toContain('Healthy');
    expect(text).not.toContain('Online');
    expect(text).not.toContain('Reachable —');
    expect(group(m, 'connectivity').headline).toBe('2 stored');
  });

  test('it states outright that reachability was never checked', () => {
    const m = buildHealthModel(projection({
      connections: { available: true, detail: '', connections: [conn('openai', 'STORED')] },
    }));
    const fact = group(m, 'connectivity').facts.find((f) => f.label === 'Provider reachable?');
    expect(fact?.value).toContain('Not checked');
  });

  test('expired is a problem and missing is attention — both named', () => {
    const m = buildHealthModel(projection({
      connections: { available: true, detail: '', connections: [conn('openai', 'EXPIRED'), conn('github', 'MISSING')] },
    }));
    expect(group(m, 'connectivity').tone).toBe('problem');
    expect(group(m, 'connectivity').notes.join(' ')).toContain('openai (production) has expired');
    expect(group(m, 'connectivity').notes.join(' ')).toContain('github (production) is not set up');
  });

  test('COULD NOT READ is not the same as NONE CONFIGURED', () => {
    const unreadable = buildHealthModel(projection({
      connections: { available: false, detail: 'the credential router did not answer', connections: [] },
    }));
    expect(group(unreadable, 'connectivity').headline).toBe('Could not be read');
    expect(group(unreadable, 'connectivity').tone).toBe('unknown');

    const none = buildHealthModel(projection());
    expect(group(none, 'connectivity').headline).toBe('None set up');
    expect(group(none, 'connectivity').tone).toBe('ok');
  });
});

describe('usage comes from the ledger, and absence is never zero', () => {
  test('a configured budget reports the ledger figures', () => {
    const m = buildHealthModel(projection());
    const facts = group(m, 'usage').facts;
    expect(facts.find((f) => f.label === 'Spent this month')?.value).toBe('$2.00');
    expect(facts.find((f) => f.label === 'Limit')?.value).toBe('$10.00');
    expect(facts.find((f) => f.label === 'Calls made')?.value).toBe('4');
    expect(facts.find((f) => f.label === 'Last call')?.value).toContain('strong');
  });

  test('NO budget configured says so — it never prints $0', () => {
    const m = buildHealthModel(projection({
      gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    }));
    expect(group(m, 'usage').headline).toBe('No spending limit set');
    // The LIMIT is what must never be invented — an unset ceiling is not a ceiling of $0.00. The
    // spend beside it is a genuine, ledger-computed zero and is reported as one; asserting the
    // string never appears anywhere would forbid telling the truth about it.
    expect(group(m, 'usage').facts.find((f) => f.label === 'Limit')?.value).toBe('Not set');
    expect(factsText(m, 'usage')).not.toContain('"label":"Limit","value":"$0.00"');
    expect(group(m, 'usage').facts.find((f) => f.label === 'Calls made')?.value).toBe('0');
  });

  test('a stopped budget is a problem and says what it means', () => {
    const m = buildHealthModel(projection({
      gatekeeperStatus: {
        configured: true,
        budget: { status: 'STOPPED', spentThisMonthMicroUsd: 10_000_000, remainingMicroUsd: 0, warnAtMicroUsd: 8_000_000, hardStopAtMicroUsd: 10_000_000 },
        spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 10_000_000, callCount: 9, lastCall: null,
      },
    }));
    expect(group(m, 'usage').tone).toBe('problem');
    expect(group(m, 'usage').notes.join(' ')).toContain('costs money will run');
  });

  test('no call ever made is recorded as none, not as a zero-cost call', () => {
    const m = buildHealthModel(projection({
      gatekeeperStatus: { ...projection().gatekeeperStatus, lastCall: null } as never,
    }));
    expect(group(m, 'usage').facts.find((f) => f.label === 'Last call')?.value).toBe('None recorded');
  });
});

describe('runtime state comes from the runtime, never from a guess', () => {
  test('a projection means running', () => {
    const m = buildHealthModel(projection());
    expect(group(m, 'runtime').headline).toBe('Running');
    expect(group(m, 'runtime').tone).toBe('ok');
  });

  test('each of the runtime\u2019s own reasons is reported in plain words', () => {
    const cases: ReadonlyArray<[string, string, string]> = [
      ['NO_RUNTIME', 'Not running on this computer', 'problem'],
      ['RUNTIME_STARTING', 'Starting up', 'attention'],
      ['RUNTIME_STOPPED', 'Stopped', 'problem'],
      ['REFUSED', 'Refused to report', 'problem'],
    ];
    for (const [reason, headline, tone] of cases) {
      const down: GovernedState = { connected: false, reason: reason as never, detail: 'detail' };
      const m = buildHealthModel(down);
      expect(group(m, 'runtime').headline).toBe(headline);
      expect(group(m, 'runtime').tone).toBe(tone);
      // No technical token reaches the owner-facing copy.
      expect(group(m, 'runtime').headline).not.toContain('_');
    }
  });

  test('nothing reported yet is unknown, not stopped', () => {
    const m = buildHealthModel(null);
    expect(group(m, 'runtime').tone).toBe('unknown');
    expect(group(m, 'runtime').headline).toBe('Not reported yet');
  });

  test('with no projection every other group is unavailable rather than invented', () => {
    const m = buildHealthModel({ connected: false, reason: 'NO_RUNTIME', detail: 'x' });
    for (const id of ['usage', 'connectivity', 'execution']) {
      expect(group(m, id).tone).toBe('unknown');
      expect(group(m, id).headline).toBe('Unavailable');
    }
  });
});

describe('execution reuses the project\u2019s own truth', () => {
  test('a waiting decision is reported and needs the owner', () => {
    const m = buildHealthModel(projection({
      pendingApprovals: [{ id: 'A1', action: 'deploy', gated: true, prohibited: false, risk: 'high', requestedBy: 'implementer', requestedAt: 't' }],
    }));
    expect(group(m, 'execution').headline).toBe('1 decision waiting for you');
    expect(m.needsOwner).toBe(true);
  });

  test('a failed run and a blocker are both counted', () => {
    const m = buildHealthModel(projection({
      sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: 't', state: 'exited', exitCode: 1 }],
      blockers: ['git is unreachable'],
    }));
    expect(group(m, 'execution').facts.find((f) => f.label === 'Runs that failed')?.value).toBe('1');
    expect(group(m, 'execution').notes).toContain('git is unreachable');
    expect(group(m, 'execution').tone).toBe('problem');
  });

  test('a quiet, ready project says nothing is running and needs nobody', () => {
    const m = buildHealthModel(projection());
    expect(group(m, 'execution').headline).toBe('Nothing running');
    expect(m.needsOwner).toBe(false);
    expect(m.tone).toBe('ok');
    expect(m.summary).toContain('nothing needs you');
  });
});

describe('the headline is never better than the worst thing underneath', () => {
  test('one problem makes the whole answer a problem', () => {
    const m = buildHealthModel(projection({ blockers: ['git is unreachable'] }));
    expect(m.tone).toBe('problem');
    expect(m.summary).toContain('cannot carry on');
  });

  test('an unknown group prevents an all-clear', () => {
    const m = buildHealthModel(projection({
      connections: { available: false, detail: 'router did not answer', connections: [] },
    }));
    expect(m.tone).toBe('unknown');
    expect(m.summary).toContain('cannot tell you everything');
  });

  test('attention outranks unknown, and problem outranks both', () => {
    const attention = buildHealthModel(projection({
      gatekeeperStatus: {
        configured: true,
        budget: { status: 'WARNING', spentThisMonthMicroUsd: 9_000_000, remainingMicroUsd: 1_000_000, warnAtMicroUsd: 8_000_000, hardStopAtMicroUsd: 10_000_000 },
        spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 9_000_000, callCount: 1, lastCall: null,
      },
      connections: { available: false, detail: 'x', connections: [] },
    }));
    expect(attention.tone).toBe('attention');
  });
});

describe('health reports and never acts', () => {
  test('no group carries a governed verb or an action of any kind', () => {
    const m = buildHealthModel(projection());
    const text = JSON.stringify(m);
    for (const verb of ['plan.decide', 'plan.activate', 'run.start', 'run.stop', 'run.resume', 'phase.', 'approval.']) {
      expect(text).not.toContain(verb);
    }
  });
});

describe('review findings — each has a test so it cannot come back', () => {
  test('HIGH: an UNMANAGED credential is never counted as stored, and is never "fine"', () => {
    // The headline counted every row while the fact counted only STORED, so one unmanaged
    // credential produced "1 stored" above "Stored: 0", reported as ok.
    const m = buildHealthModel(projection({
      connections: { available: true, detail: '', connections: [conn('openai', 'UNMANAGED')] },
    }));
    const g = group(m, 'connectivity');
    expect(g.facts.find((f) => f.label === 'Stored')?.value).toBe('0');
    expect(g.facts.find((f) => f.label === 'Set up outside ProjectOS')?.value).toBe('1');
    expect(g.headline).toBe('0 stored, 1 set up outside ProjectOS');
    // Nothing is known about it, so the answer is "not known" — not "fine".
    expect(g.tone).toBe('unknown');
    expect(m.tone).not.toBe('ok');
  });

  test('HIGH: a failed run is named in the headline, not just coloured', () => {
    // `failed` decided the tone but appeared in no headline, so a just-failed run rendered a red
    // dot beside the words "Nothing running".
    const one = buildHealthModel(projection({
      sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: 't', state: 'exited', exitCode: 1 }],
    }));
    expect(group(one, 'execution').headline).toBe('A run failed');
    expect(group(one, 'execution').tone).toBe('problem');

    const many = buildHealthModel(projection({
      sessions: [
        { sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: 't', state: 'exited', exitCode: 1 },
        { sessionId: 'S2', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: 't', state: 'exited', exitCode: 2 },
      ],
    }));
    expect(group(many, 'execution').headline).toBe('2 runs failed');
  });

  test('a problem is never hidden behind something calmer', () => {
    const m = buildHealthModel(projection({
      blockers: ['git is unreachable'],
      pendingApprovals: [{ id: 'A1', action: 'deploy', gated: true, prohibited: false, risk: 'high', requestedBy: 'i', requestedAt: 't' }],
    }));
    expect(group(m, 'execution').headline).toBe('Blocked');
  });

  test('MEDIUM: two credentials for one provider stay two distinct notes', () => {
    const prod = { ...conn('openai', 'EXPIRED') } as never;
    const stage = { ...(conn('openai', 'EXPIRED') as never), environment: 'staging' } as never;
    const m = buildHealthModel(projection({
      connections: { available: true, detail: '', connections: [prod, stage] },
    }));
    const notes = group(m, 'connectivity').notes;
    expect(notes.length).toBe(2);
    expect(new Set(notes).size).toBe(2);
    expect(notes.join(' ')).toContain('production');
    expect(notes.join(' ')).toContain('staging');
  });

  test('MEDIUM: a genuine zero is reported as zero, not as "not recorded"', () => {
    // The ledger always computes these, so a new project that has spent nothing HAS spent nothing.
    const m = buildHealthModel(projection({
      gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    }));
    expect(group(m, 'usage').facts.find((f) => f.label === 'Calls made')?.value).toBe('0');
    expect(group(m, 'usage').facts.find((f) => f.label === 'Spent on this project')?.value).toBe('$0.00');
    // The LIMIT is still absent, and still says so.
    expect(group(m, 'usage').facts.find((f) => f.label === 'Limit')?.value).toBe('Not set');
  });

  test('LOW: a corrupt negative figure is an anomaly, never $0.00', () => {
    const m = buildHealthModel(projection({
      gatekeeperStatus: {
        configured: true,
        budget: { status: 'OK', spentThisMonthMicroUsd: -5, remainingMicroUsd: 1, warnAtMicroUsd: 2, hardStopAtMicroUsd: 3 },
        spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null,
      },
    }));
    expect(group(m, 'usage').facts.find((f) => f.label === 'Spent this month')?.value).toBe('Not recorded');
  });
});

/* ------------------------------------------------------------------------------------------------
 * A RECORD IS NOT A RUNNING PROCESS — PROJECTOS-PROVIDER-RUNTIME-TRUTH-FIX1A.
 *
 * Execution activity used to be derived from session RECORDS: any session whose state was not
 * `exited` counted as running. A session record is written when a worker starts and rewritten when
 * it exits, so a worker killed, crashed or lost to a reboot leaves `started` on disk for ever — and
 * nothing can correct it, because the record carries no process identity. Health then reported
 * "Working" and "Running now: 1" for a process that no longer existed.
 *
 * Liveness now comes from the daemon's own live run fact, which is real: that process started the
 * child and can still stop it. History stays history.
 * --------------------------------------------------------------------------------------------- */

const startedSession = {
  sessionId: 'S9', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: 't', state: 'started', exitCode: null,
};

describe('current activity comes from the live daemon, never from a record', () => {
  test('a live worker is reported as working', () => {
    const m = buildHealthModel(projection({ sessions: [startedSession] } as never), { active: true });
    const g = group(m, 'execution');
    expect(g.headline).toBe('Working');
    expect(g.facts.find((f) => f.label === 'Running now')?.value).toBe('Yes');
    expect(g.tone).toBe('ok');
  });

  test('THE DEFECT: a started record with no live run must not say Working', () => {
    const m = buildHealthModel(projection({ sessions: [startedSession] } as never), { active: false });
    const g = group(m, 'execution');
    expect(g.headline).not.toBe('Working');
    expect(JSON.stringify(g)).not.toContain('Running now: 1');
    // Not known is not the same as not running, so it is not claimed either way.
    expect(g.facts.find((f) => f.label === 'Running now')?.value).toBeNull();
    expect(g.tone).toBe('unknown');
  });

  test('an absent live answer is unknown, never working', () => {
    // The panel may open after a run began, so this store never saw it start. Claiming activity
    // from the record would be exactly the defect; claiming none would be a different invention.
    const m = buildHealthModel(projection({ sessions: [startedSession] } as never));
    const g = group(m, 'execution');
    expect(g.headline).not.toBe('Working');
    expect(g.tone).toBe('unknown');
    expect(g.facts.find((f) => f.label === 'Running now')?.value).toBeNull();
  });

  test('nothing recorded and nothing live is plainly nothing running', () => {
    const m = buildHealthModel(projection(), { active: false });
    const g = group(m, 'execution');
    expect(g.headline).toBe('Nothing running');
    expect(g.facts.find((f) => f.label === 'Running now')?.value).toBe('No');
    expect(g.tone).toBe('ok');
  });

  test('history survives the fix — an unfinished record is still reported as one', () => {
    const m = buildHealthModel(projection({ sessions: [startedSession] } as never), { active: false });
    const g = group(m, 'execution');
    expect(g.facts.find((f) => f.label === 'Recorded runs not marked finished')?.value).toBe('1');
    expect(g.notes.join(' ')).toContain('never marked finished');
  });

  test('a failed run still outranks an unconfirmed one', () => {
    const m = buildHealthModel(projection({
      sessions: [startedSession, { sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: 't', state: 'exited', exitCode: 1 }],
    } as never), { active: false });
    expect(group(m, 'execution').headline).toBe('A run failed');
    expect(group(m, 'execution').tone).toBe('problem');
  });

  test('a live run cannot be manufactured from anything the projection carries', () => {
    // Every field an attacker or a bug could reach through the projection, set to look busy.
    const m = buildHealthModel(projection({
      sessions: [startedSession, { ...startedSession, sessionId: 'S8', state: 'rejoined' }],
      activePhase: { phaseId: 'TWO', title: 'T', status: 'in_progress', dependencies: [], accepted: false } as never,
    } as never));
    expect(group(m, 'execution').facts.find((f) => f.label === 'Running now')?.value).not.toBe('Yes');
  });
});
