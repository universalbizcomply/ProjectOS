/**
 * The governed command result contract.
 *
 * These tests exist because of a real defect: the client resolved as soon as the request was
 * DISPATCHED, and the runtime's actual verdict — arriving later as a `governed-result` — was never
 * consumed. A G4 closure refusal therefore reached the owner as "Sent to the runtime", with the
 * action refused and nothing saying so. Each case below pins one part of the corrected contract.
 */
import { describe, it, expect, vi } from 'vitest';
import { IPC_EVENT_CHANNEL } from '../src/daemon/ipcCommands';
import { GOVERNED_RESULT_KIND } from '../src/governed/governedCommands';
import { requestGovernedCommand, GOVERNED_TAURI_COMMAND } from '../src/governed/governedClient';
import type { IpcBridge } from '../src/daemon/ipcBridge';

interface Recorder {
  readonly bridge: IpcBridge;
  readonly order: string[];
  readonly unlistens: number[];
  emit(payload: unknown): void;
}

/**
 * A bridge that records the ORDER of listen/invoke, so the listener-before-dispatch guarantee is
 * observable rather than assumed, and that can emit events on demand.
 */
function recorder(options: { onInvoke?: () => void | Promise<void>; emitDuringInvoke?: unknown } = {}): Recorder {
  const order: string[] = [];
  const unlistens: number[] = [];
  let handler: ((payload: unknown) => void) | null = null;
  let listenerId = 0;

  const emit = (payload: unknown): void => {
    if (handler !== null) handler(payload);
  };

  const bridge: IpcBridge = {
    isTauri: () => true,
    invoke: async (command: string) => {
      order.push(`invoke:${command}`);
      if (options.onInvoke !== undefined) await options.onInvoke();
      // A runtime fast enough to answer inside the dispatch call must still be heard.
      if (options.emitDuringInvoke !== undefined) emit(options.emitDuringInvoke);
      return undefined;
    },
    listen: async (event: string, h: (payload: unknown) => void) => {
      order.push(`listen:${event}`);
      handler = h;
      const id = (listenerId += 1);
      return () => {
        unlistens.push(id);
        handler = null;
      };
    },
  };

  return { bridge, order, unlistens, emit };
}

const result = (correlationId: string, code: number, lines: readonly string[]) => ({
  kind: GOVERNED_RESULT_KIND,
  correlationId,
  code,
  lines,
  verb: 'phase.close',
});

const REFUSAL = ['REFUSED (G4_NOT_SATISFIED): 3 predicate(s) unmet for delegated closure:', '  G4-8: no passing proof'];

describe('requestGovernedCommand', () => {
  it('R1 registers the result listener BEFORE dispatching the command', async () => {
    const r = recorder();
    const pending = requestGovernedCommand(r.bridge, 'refresh', {}, { correlationId: 'cc-1' });
    // Give the listen() await a turn, then answer.
    await Promise.resolve();
    r.emit(result('cc-1', 0, ['Refreshed governed state.']));
    await pending;

    expect(r.order[0]).toBe(`listen:${IPC_EVENT_CHANNEL}`);
    expect(r.order[1]).toBe(`invoke:${GOVERNED_TAURI_COMMAND}`);
  });

  it('R2 reports the runtime lines for a successful result', async () => {
    const r = recorder({ emitDuringInvoke: result('cc-2', 0, ['Refreshed governed state.']) });
    const outcome = await requestGovernedCommand(r.bridge, 'refresh', {}, { correlationId: 'cc-2' });
    expect(outcome.ok).toBe(true);
    expect(outcome.lines).toEqual(['Refreshed governed state.']);
  });

  it('R3 shows a refusal verbatim', async () => {
    const r = recorder({ emitDuringInvoke: result('cc-3', 2, REFUSAL) });
    const outcome = await requestGovernedCommand(
      r.bridge,
      'phase.close',
      { phaseId: 'P' },
      { correlationId: 'cc-3' },
    );
    // Verbatim: not summarised, not reworded, not truncated.
    expect(outcome.lines).toEqual(REFUSAL);
  });

  it('R4 treats a non-zero code as failure', async () => {
    const r = recorder({ emitDuringInvoke: result('cc-4', 2, REFUSAL) });
    const outcome = await requestGovernedCommand(
      r.bridge,
      'phase.close',
      { phaseId: 'P' },
      { correlationId: 'cc-4' },
    );
    expect(outcome.ok).toBe(false);
  });

  it('R5 ignores a result for a different command', async () => {
    const r = recorder();
    const pending = requestGovernedCommand(r.bridge, 'refresh', {}, { correlationId: 'cc-5', timeoutMs: 40 });
    await Promise.resolve();
    r.emit(result('cc-OTHER', 0, ['not mine']));
    const outcome = await pending;
    // The foreign result must not have resolved this command; only the timeout can.
    expect(outcome.ok).toBe(false);
    expect(outcome.lines.join(' ')).toContain('did not report a result');
  });

  it('R6 resolves on the matching result even after an unrelated one', async () => {
    const r = recorder();
    const pending = requestGovernedCommand(r.bridge, 'refresh', {}, { correlationId: 'cc-6' });
    await Promise.resolve();
    r.emit(result('cc-OTHER', 2, ['someone else was refused']));
    r.emit(result('cc-6', 0, ['mine']));
    const outcome = await pending;
    expect(outcome.ok).toBe(true);
    expect(outcome.lines).toEqual(['mine']);
  });

  it('R7 does not lose a result emitted during dispatch', async () => {
    const r = recorder({ emitDuringInvoke: result('cc-7', 0, ['fast']) });
    const outcome = await requestGovernedCommand(r.bridge, 'refresh', {}, { correlationId: 'cc-7', timeoutMs: 50 });
    expect(outcome.lines).toEqual(['fast']);
  });

  it('R8 surfaces a host transport failure', async () => {
    const r = recorder({
      onInvoke: () => {
        throw new Error('the host refused');
      },
    });
    const outcome = await requestGovernedCommand(r.bridge, 'refresh', {}, { correlationId: 'cc-8' });
    expect(outcome.ok).toBe(false);
    expect(outcome.lines[0]).toContain('REFUSED (HOST)');
    expect(outcome.lines[0]).toContain('the host refused');
  });

  it('R9 reports a truthful failure when no result ever arrives', async () => {
    const r = recorder();
    const outcome = await requestGovernedCommand(r.bridge, 'refresh', {}, { correlationId: 'cc-9', timeoutMs: 30 });
    expect(outcome.ok).toBe(false);
    // It must not imply success, and must not claim the command definitely did not run.
    expect(outcome.lines.join(' ')).toContain('did not report a result');
    expect(outcome.lines.join(' ').toLowerCase()).not.toContain('success');
  });

  it('R10 releases the listener after a success', async () => {
    const r = recorder({ emitDuringInvoke: result('cc-10', 0, ['ok']) });
    await requestGovernedCommand(r.bridge, 'refresh', {}, { correlationId: 'cc-10' });
    expect(r.unlistens.length).toBe(1);
  });

  it('R11 releases the listener after a refusal', async () => {
    const r = recorder({ emitDuringInvoke: result('cc-11', 2, REFUSAL) });
    await requestGovernedCommand(r.bridge, 'phase.close', { phaseId: 'P' }, { correlationId: 'cc-11' });
    expect(r.unlistens.length).toBe(1);
  });

  it('R12 releases the listener after a transport failure and after a timeout', async () => {
    const failing = recorder({
      onInvoke: () => {
        throw new Error('nope');
      },
    });
    await requestGovernedCommand(failing.bridge, 'refresh', {}, { correlationId: 'cc-12a' });
    expect(failing.unlistens.length).toBe(1);

    const silent = recorder();
    await requestGovernedCommand(silent.bridge, 'refresh', {}, { correlationId: 'cc-12b', timeoutMs: 20 });
    expect(silent.unlistens.length).toBe(1);
  });

  it('R13 refuses an invalid request without dispatching anything', async () => {
    const r = recorder();
    const outcome = await requestGovernedCommand(
      r.bridge,
      'phase.advance',
      // `toStatus` is required; a malformed request must never reach the runtime.
      { phaseId: 'P' } as never,
      { correlationId: 'cc-13' },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.lines[0]).toContain('REFUSED');
    expect(r.order).toEqual([]);
  });

  it('refuses outside the desktop app rather than pretending to send', async () => {
    const bridge: IpcBridge = {
      isTauri: () => false,
      invoke: vi.fn(),
      listen: vi.fn(),
    };
    const outcome = await requestGovernedCommand(bridge, 'refresh', {});
    expect(outcome.ok).toBe(false);
    expect(bridge.invoke).not.toHaveBeenCalled();
    expect(bridge.listen).not.toHaveBeenCalled();
  });

  it('accepts a result delivered as a JSON string by the transport', async () => {
    const r = recorder({ emitDuringInvoke: JSON.stringify(result('cc-14', 2, REFUSAL)) });
    const outcome = await requestGovernedCommand(
      r.bridge,
      'phase.close',
      { phaseId: 'P' },
      { correlationId: 'cc-14' },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.lines).toEqual(REFUSAL);
  });
});
