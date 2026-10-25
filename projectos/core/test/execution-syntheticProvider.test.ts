import { describe, it, expect } from 'vitest';
import { SyntheticExecutionProvider, type ExecutionIdentity } from '../src/execution/index.js';

const ID: ExecutionIdentity = {
  projectId: 'projectos', phaseId: 'PH1', environment: 'local',
  operationId: 'op1', providerId: 'synthetic-1', providerKind: 'synthetic',
};

describe('synthetic provider', () => {
  it('is unmistakably labelled and grants no external access', () => {
    const p = new SyntheticExecutionProvider();
    expect(p.metadata.label).toBe('SYNTHETIC — NOT A REAL WORKER');
    expect(p.metadata.providerKind).toBe('synthetic');
    expect(p.metadata.externalNetworkAllowed).toBe(false);
    expect(p.metadata.secretAccessAllowed).toBe(false);
    expect(p.metadata.productRepositoryAccessAllowed).toBe(false);
  });

  it('counts invocations and returns deterministic acks by default', () => {
    const p = new SyntheticExecutionProvider();
    expect(p.start(ID).kind).toBe('ack');
    expect(p.pause(ID).kind).toBe('ack');
    p.start(ID);
    expect(p.calls.start).toBe(2);
    expect(p.calls.pause).toBe(1);
  });

  it('honours configured results and capability toggles', () => {
    const p = new SyntheticExecutionProvider({ startResult: 'failed', pauseResult: 'refused', unsupported: ['resume'] });
    expect(p.start(ID).kind).toBe('failed');
    expect(p.pause(ID).kind).toBe('refused');
    expect(p.metadata.capabilities.resume).toBe(false);
    expect(p.metadata.capabilities.start).toBe(true);
  });

  it('probe is deterministic and defaults to terminated', () => {
    const p = new SyntheticExecutionProvider();
    expect(p.probe(ID).kind).toBe('terminated');
    expect(new SyntheticExecutionProvider({ probeResult: 'running' }).probe(ID).kind).toBe('running');
  });
});
