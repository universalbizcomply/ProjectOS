import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeContextPorts, portsProblem } from '../src/context/contextPorts.js';
import { nodeEnsureDirectory, openProjectSearchIndex } from '../src/search/index.js';
import type { System } from '../src/system.js';
import { worldPorts } from './support/contextWorld.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'projectos-ports-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const system = (over: Partial<System> = {}): System =>
  ({
    cwd: () => '/',
    now: () => '2026-11-14T10:00:00.000Z',
    readText: () => null,
    writeText: () => undefined,
    exists: (path: string) => path.endsWith('.sqlite') && over.exists !== undefined ? over.exists(path) : false,
    listDir: () => [],
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: () => ({ code: 1, stdout: '', stderr: '' }),
    ...over,
  }) as System;

describe('a port that is missing is a refusal, never a default', () => {
  it('names the first port that cannot be used', () => {
    const ports = worldPorts().ports;
    expect(portsProblem(ports)).toBeNull();
    const cases: readonly [string, object][] = [
      ['git', { git: undefined }],
      ['fs', { fs: undefined }],
      ['fs', { fs: { readText: () => null } }],
      ['clock', { clock: undefined }],
      ['clock', { clock: {} }],
      ['secretScreen', { secretScreen: 'no' }],
      ['isProxy', { isProxy: undefined }],
      ['readMemoryStore', { readMemoryStore: undefined }],
      ['openIndex', { openIndex: 'index' }],
    ];
    for (const [name, patch] of cases) expect(portsProblem({ ...ports, ...patch } as never)).toBe(name);
    for (const value of [null, undefined, 'ports', 7]) expect(portsProblem(value as never)).toBe('ports');
  });

  it('accepts no index port as an explicit null, and nothing else but a function', () => {
    const ports = worldPorts().ports;
    expect(portsProblem({ ...ports, openIndex: null })).toBeNull();
    expect(portsProblem({ ...ports, openIndex: undefined as never })).toBe('openIndex');
  });
});

describe('the production ports are made from the System', () => {
  it('are complete, and the Proxy test is the runtime own', () => {
    const ports = nodeContextPorts(system(), '/work/project', () => null);
    expect(portsProblem(ports)).toBeNull();
    expect(ports.isProxy(new Proxy({}, {}))).toBe(true);
    expect(ports.isProxy({})).toBe(false);
    expect(ports.registry).toBeNull();
  });

  it('opens no index when the installation gives no directory, and none nobody built', () => {
    const owner = { tenant: 'agency-one', project: 'alpha-project' };
    expect(nodeContextPorts(system(), '/work/project', () => null).openIndex?.(owner)).toBeNull();
    expect(nodeContextPorts(system(), '/work/project', () => join(dir, 'indexes')).openIndex?.(owner)).toBeNull();
  });

  it('opens the index of the owner it is asked for once its file is there, and writes nothing to make it', () => {
    const owner = { tenant: 'agency-one', project: 'alpha-project' };
    const directory = join(dir, 'indexes');
    const built = openProjectSearchIndex(directory, owner, { clock: { nowMs: () => 1000 }, ensureDirectory: nodeEnsureDirectory });
    if (!built.ok) throw new Error(built.reason);
    built.index.close();
    const sys = system({ exists: (path: string) => path === built.location });
    const opened = nodeContextPorts(sys, '/work/project', () => directory).openIndex?.(owner);
    expect(opened).not.toBeNull();
    opened?.close();
    const other = nodeContextPorts(sys, '/work/project', () => directory).openIndex?.({ tenant: 'agency-one', project: 'beta-project' });
    expect(other).toBeNull();
  });
});
