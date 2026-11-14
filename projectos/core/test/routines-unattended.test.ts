import { describe, expect, it } from 'vitest';
import {
  UNATTENDED_CEILING,
  admitUnattendedAction,
  type OwnerQueueEscalation,
} from '../src/routines/index.js';
import { committedRegistry } from './routines-support.js';

const request = (action: string) => ({ routineId: 'weekday-summary', occurrenceId: 'weekday-summary@2026-11-13T09:00:00.000Z', action });

const queue = (accepts = true): { escalate: (escalation: OwnerQueueEscalation) => boolean; sent: OwnerQueueEscalation[] } => {
  const sent: OwnerQueueEscalation[] = [];
  return {
    sent,
    escalate: (escalation) => {
      sent.push(escalation);
      return accepts;
    },
  };
};

describe('an unattended run refuses P3 and above, and escalates', () => {
  const registry = committedRegistry();

  it('states the ceiling', () => {
    expect(UNATTENDED_CEILING).toBe('P2');
  });

  it('admits a P2 action and sends nothing to the owner: the control', () => {
    const { escalate, sent } = queue();
    const result = admitUnattendedAction(request('implement'), registry, escalate);
    expect(result).toEqual({ ok: true, actionClass: 'P2' });
    expect(sent).toEqual([]);
  });

  it('admits a P1 action', () => {
    expect(admitUnattendedAction(request('run_validators'), registry, queue().escalate).ok).toBe(true);
  });

  it.each([
    ['commit', 'P3'],
    ['push', 'P3'],
    ['broker-call', 'P3'],
    ['approve', 'P5'],
    ['payment-or-live-charge', 'P5'],
  ])('refuses %s (%s) and escalates it once to the owner queue', (action, actionClass) => {
    const { escalate, sent } = queue();
    const result = admitUnattendedAction(request(action), registry, escalate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNATTENDED_GATED_ACTION');
      expect(result.escalated).toBe(true);
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ routineId: 'weekday-summary', action, actionClass });
    expect(sent[0]?.occurrenceId).toBe(request(action).occurrenceId);
  });

  it('reads the class from the registry, so an action the registry does not know is P5 and refused', () => {
    const { escalate, sent } = queue();
    const result = admitUnattendedAction(request('send-the-newsletter'), registry, escalate);
    expect(result.ok).toBe(false);
    expect(sent[0]?.actionClass).toBe('P5');
  });

  it('is refused all the same when the owner queue cannot take the item, and says it was not escalated', () => {
    const result = admitUnattendedAction(request('commit'), registry, queue(false).escalate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.escalated).toBe(false);
  });

  it('does not count a truthy answer that is not true as an escalation', () => {
    const result = admitUnattendedAction(request('commit'), registry, (() => 1) as unknown as () => boolean);
    expect(result.ok).toBe(false);
    if (!result.ok && result.code === 'UNATTENDED_GATED_ACTION') expect(result.escalated).toBe(false);
  });

  it('refuses an action name that is not a plain word', () => {
    const { escalate, sent } = queue();
    expect(admitUnattendedAction(request('implement now'), registry, escalate).ok).toBe(false);
    expect(admitUnattendedAction(request(''), registry, escalate).ok).toBe(false);
    expect(sent).toEqual([]);
  });
});
