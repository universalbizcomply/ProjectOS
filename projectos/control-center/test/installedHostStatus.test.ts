import { describe, test, expect } from 'vitest';
import {
  INSTALLED_HOST_STATUS_COMMAND,
  UNAVAILABLE,
  parseInstalledHostStatus,
  readInstalledHostStatus,
  unavailableView,
} from '../src/daemon/installedHostStatus.js';
import type { IpcBridge } from '../src/daemon/ipcBridge.js';

/** A well-formed host answer: the shape the Rust command actually serialises. */
const HOST_ANSWER = JSON.stringify({
  serviceState: 'RUNNING',
  identityVerification: 'VERIFIED',
  channel: 'STABLE',
  buildPrefix: '93e58f48',
  manifestPrefix: 'a1b2c3d4',
  readiness: 'READY',
  protectedOperations: 'REFUSED',
  readSucceeded: true,
  nextSafeAction: 'The installed host answered this read-only status request.',
});

function bridge(invoke: () => Promise<unknown>, isTauri = true): IpcBridge {
  return {
    isTauri: () => isTauri,
    invoke,
    listen: async () => async () => {},
  };
}

describe('installed host status · parsing', () => {
  test('renders exactly what the host returned when the answer is complete', () => {
    const v = parseInstalledHostStatus(HOST_ANSWER);
    expect(v.readSucceeded).toBe(true);
    expect(v.serviceState).toBe('RUNNING');
    expect(v.identityVerification).toBe('VERIFIED');
    expect(v.channel).toBe('STABLE');
    expect(v.buildPrefix).toBe('93e58f48');
    expect(v.manifestPrefix).toBe('a1b2c3d4');
    expect(v.readiness).toBe('READY');
    expect(v.protectedOperations).toBe('REFUSED');
  });

  test('a refused host is never displayed as verified or ready', () => {
    const v = parseInstalledHostStatus(
      JSON.stringify({
        serviceState: 'RUNNING',
        identityVerification: 'REFUSED',
        channel: 'UNKNOWN',
        buildPrefix: '00000000',
        manifestPrefix: '00000000',
        readiness: 'NOT_READY',
        protectedOperations: 'REFUSED',
        readSucceeded: true,
        nextSafeAction: 'answered',
      }),
    );
    expect(v.identityVerification).toBe('REFUSED');
    expect(v.readiness).toBe('NOT_READY');
    expect(v.identityVerification).not.toBe('VERIFIED');
    expect(v.readiness).not.toBe('READY');
  });

  test('a protected-operations refusal is never displayed as authorised', () => {
    const v = parseInstalledHostStatus(HOST_ANSWER);
    expect(v.protectedOperations).toBe('REFUSED');
    expect(v.protectedOperations).not.toBe('AUTHORISED');
  });

  test('an incomplete answer makes the WHOLE view unavailable', () => {
    const v = parseInstalledHostStatus(
      JSON.stringify({ serviceState: 'RUNNING', identityVerification: 'VERIFIED' }),
    );
    expect(v.readSucceeded).toBe(false);
    expect(v.identityVerification).toBe(UNAVAILABLE);
    expect(v.readiness).toBe(UNAVAILABLE);
  });

  test('malformed and non-string answers are unavailable, never partially trusted', () => {
    expect(parseInstalledHostStatus('{not json').readSucceeded).toBe(false);
    expect(parseInstalledHostStatus(null).readSucceeded).toBe(false);
    expect(parseInstalledHostStatus({ serviceState: 'RUNNING' }).readSucceeded).toBe(false);
    expect(parseInstalledHostStatus('null').readSucceeded).toBe(false);
  });

  test('readSucceeded is only ever true when the host said exactly true', () => {
    const v = parseInstalledHostStatus(
      JSON.stringify({
        serviceState: 'RUNNING',
        identityVerification: 'VERIFIED',
        channel: 'STABLE',
        buildPrefix: '93e58f48',
        manifestPrefix: 'a1b2c3d4',
        readiness: 'READY',
        protectedOperations: 'REFUSED',
        readSucceeded: 'true',
        nextSafeAction: 'answered',
      }),
    );
    expect(v.readSucceeded).toBe(false);
  });

  test('the unavailable view exposes no verified, ready or authorised value', () => {
    const v = unavailableView('nothing was read');
    for (const field of [
      v.serviceState,
      v.identityVerification,
      v.channel,
      v.buildPrefix,
      v.manifestPrefix,
      v.readiness,
      v.protectedOperations,
    ]) {
      expect(field).toBe(UNAVAILABLE);
    }
    expect(v.readSucceeded).toBe(false);
  });
});

describe('installed host status · reading', () => {
  test('uses the one read-only command and nothing else', async () => {
    const calls: string[] = [];
    const recording: IpcBridge = {
      isTauri: () => true,
      invoke: async (command) => {
        calls.push(command);
        return HOST_ANSWER;
      },
      listen: async () => async () => {},
    };
    const v = await readInstalledHostStatus(recording);
    expect(v.readSucceeded).toBe(true);
    expect(calls).toEqual([INSTALLED_HOST_STATUS_COMMAND]);
  });

  test('outside the desktop app nothing is read and nothing is claimed', async () => {
    const v = await readInstalledHostStatus(
      bridge(async () => {
        throw new Error('must not be called');
      }, false),
    );
    expect(v.readSucceeded).toBe(false);
    expect(v.readiness).toBe(UNAVAILABLE);
  });

  test('a transport failure yields the unavailable view, never a fabricated one', async () => {
    const v = await readInstalledHostStatus(
      bridge(async () => {
        throw new Error('pipe unavailable');
      }),
    );
    expect(v.readSucceeded).toBe(false);
    expect(v.identityVerification).toBe(UNAVAILABLE);
  });
});
