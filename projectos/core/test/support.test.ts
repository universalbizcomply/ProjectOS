import { describe, it, expect } from 'vitest';
import {
  EMPTY_LOG,
  append,
  filterByType,
  filterByActor,
  latest,
  EventBus,
  type DomainEvent,
} from '../src/events.js';
import { parseProjectConfig } from '../src/config.js';
import {
  parseRemoteUrl,
  currentBranchFromHead,
  isProtectedBranch,
} from '../src/discovery.js';
import {
  EMPTY_REGISTRY,
  register,
  get,
  withCapability,
  list,
  type PluginManifest,
} from '../src/plugins.js';

const AT = '2026-07-08T00:00:00.000Z';

function evt(type: string, actor: 'owner' | 'advisor' | 'implementer'): DomainEvent {
  return { id: type + actor, type, at: AT, actor, payload: {} };
}

describe('event log', () => {
  it('appends immutably and queries', () => {
    const l1 = append(EMPTY_LOG, evt('phase.created', 'implementer'));
    const l2 = append(l1, evt('phase.closed', 'owner'));
    expect(EMPTY_LOG).toHaveLength(0);
    expect(l1).toHaveLength(1);
    expect(l2).toHaveLength(2);
    expect(filterByType(l2, 'phase.closed')).toHaveLength(1);
    expect(filterByActor(l2, 'owner')).toHaveLength(1);
    expect(latest(l2)?.type).toBe('phase.closed');
    expect(latest(EMPTY_LOG)).toBeUndefined();
  });

  it('EventBus publishes to subscribers and supports unsubscribe', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push(e.type));
    bus.publish(evt('a', 'owner'));
    expect(bus.size).toBe(1);
    off();
    bus.publish(evt('b', 'owner'));
    expect(seen).toEqual(['a']);
    expect(bus.size).toBe(0);
  });
});

const VALID_CONFIG = {
  projectId: 'polygo',
  projectName: 'PolyGo',
  projectType: 'saas',
  owner: 'Murad',
  repo: 'universalbizcomply/polygo',
  localPath: 'C:/dev/polygo',
  protectedBranches: ['main'],
  productionFreeze: false,
  allowedActions: ['implement'],
  forbiddenActions: ['force-push'],
  approvalGates: ['productionDeploy'],
  secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true },
  validators: ['npm run validate'],
  evidenceRequirements: ['phase-report'],
  installStatus: 'planned',
};

describe('config loader', () => {
  it('accepts a valid config', () => {
    const r = parseProjectConfig(VALID_CONFIG);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.projectId).toBe('polygo');
  });

  it('rejects non-objects', () => {
    expect(parseProjectConfig(null).ok).toBe(false);
    expect(parseProjectConfig('nope').ok).toBe(false);
    expect(parseProjectConfig([]).ok).toBe(false);
  });

  it('collects multiple errors at once', () => {
    const r = parseProjectConfig({ ...VALID_CONFIG, projectId: '', productionFreeze: 'no', installStatus: 'bogus' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('projectId');
      expect(r.error).toContain('productionFreeze');
      expect(r.error).toContain('installStatus');
    }
  });

  it('requires non-empty forbiddenActions and approvalGates', () => {
    const r = parseProjectConfig({ ...VALID_CONFIG, forbiddenActions: [], approvalGates: [] });
    expect(r.ok).toBe(false);
  });

  it('validates secretsPolicy shape', () => {
    const r = parseProjectConfig({ ...VALID_CONFIG, secretsPolicy: { allowSecretsInRepo: 'x' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('secretsPolicy');
  });
});

describe('project discovery', () => {
  it('parses https and ssh remotes', () => {
    expect(parseRemoteUrl('https://github.com/universalbizcomply/ProjectOS.git')?.slug).toBe(
      'universalbizcomply/ProjectOS',
    );
    expect(parseRemoteUrl('git@github.com:owner/name.git')?.slug).toBe('owner/name');
    expect(parseRemoteUrl('https://github.com/o/n')?.name).toBe('n');
  });

  it('returns null for junk remotes', () => {
    expect(parseRemoteUrl('not a url')).toBeNull();
  });

  it('reads branch from HEAD, null on detached', () => {
    expect(currentBranchFromHead('ref: refs/heads/main\n')).toBe('main');
    expect(currentBranchFromHead('ref: refs/heads/feature/x')).toBe('feature/x');
    expect(currentBranchFromHead('a1b2c3d4')).toBeNull();
  });

  it('detects protected branches', () => {
    expect(isProtectedBranch('main', ['main', 'release'])).toBe(true);
    expect(isProtectedBranch('dev', ['main'])).toBe(false);
  });
});

describe('plugin registry', () => {
  const gh: PluginManifest = {
    id: 'github',
    displayName: 'GitHub',
    version: '1.0.0',
    capabilities: ['scm', 'pr'],
    external: true,
  };

  it('registers and resolves by id and capability', () => {
    const r = register(EMPTY_REGISTRY, gh);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(get(r.value, 'github')?.displayName).toBe('GitHub');
    expect(withCapability(r.value, 'pr')).toHaveLength(1);
    expect(withCapability(r.value, 'none')).toHaveLength(0);
    expect(list(r.value)).toHaveLength(1);
  });

  it('rejects duplicates and capability-less plugins', () => {
    const r = register(EMPTY_REGISTRY, gh);
    if (!r.ok) return;
    expect(register(r.value, gh).ok).toBe(false);
    expect(register(EMPTY_REGISTRY, { ...gh, capabilities: [] }).ok).toBe(false);
  });
});
