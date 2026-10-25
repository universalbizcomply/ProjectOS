import { describe, test, expect } from 'vitest';
import { kindForPath, classifyChange } from '../src/watchers/watchRouter.js';
import { scanProjects } from '../src/watchers/projectScanner.js';
import { FileWatcher } from '../src/watchers/fileWatcher.js';
import { createFakeSystem } from './helpers/fakeSystem.js';
import type { ProjectDescriptor } from '../src/types.js';

describe('watchRouter', () => {
  test('kindForPath classifies each area', () => {
    expect(kindForPath('/r/.git/HEAD')).toBe('git');
    expect(kindForPath('/r/.projectops/bridge/prompts/p.json')).toBe('prompt');
    expect(kindForPath('/r/.projectops/bridge/reports/x.md')).toBe('report');
    expect(kindForPath('/r/.projectops/bridge/evidence/e.json')).toBe('evidence');
    expect(kindForPath('/r/.projectops/bridge/events/event-log.jsonl')).toBe('event');
    expect(kindForPath('/r/.projectops/bridge/state/state.json')).toBe('state');
    expect(kindForPath('/r/.projectops/bridge/approvals/a.json')).toBe('approval');
    expect(kindForPath('/r/.projectops/workers/w.json')).toBe('worker');
    expect(kindForPath('/r/.projectops/phases/ph.json')).toBe('phase');
    expect(kindForPath('/r/src/app.ts')).toBe('unknown');
  });

  test('classifyChange attributes to the longest matching root', () => {
    const projects: ProjectDescriptor[] = [
      { name: 'outer', root: '/dev', bridgeDir: '/dev/.projectops/bridge', hasBridge: true },
      { name: 'inner', root: '/dev/app', bridgeDir: '/dev/app/.projectops/bridge', hasBridge: true },
    ];
    const c = classifyChange('/dev/app/.projectops/bridge/events/event-log.jsonl', projects);
    expect(c?.project).toBe('inner');
    expect(c?.kind).toBe('event');
  });

  test('classifyChange returns null for unknown project or unknown kind', () => {
    const projects: ProjectDescriptor[] = [
      { name: 'a', root: '/a', bridgeDir: '/a/.projectops/bridge', hasBridge: true },
    ];
    expect(classifyChange('/x/file', projects)).toBeNull();
    expect(classifyChange('/a/src/app.ts', projects)).toBeNull();
  });
});

describe('projectScanner', () => {
  test('detects a root that is itself a project', () => {
    const sys = createFakeSystem();
    sys.mkdir('/repo/.projectops');
    const found = scanProjects(sys, ['/repo']);
    expect(found.map((p) => p.name)).toEqual(['repo']);
    expect(found[0]?.hasBridge).toBe(false);
  });

  test('detects project subfolders one level deep, sorted, deduped', () => {
    const sys = createFakeSystem();
    sys.mkdir('/dev/alpha/.projectops/bridge');
    sys.mkdir('/dev/beta/.projectops');
    sys.mkdir('/dev/node_modules/x');
    const found = scanProjects(sys, ['/dev', '/dev'], ['node_modules']);
    expect(found.map((p) => p.name)).toEqual(['alpha', 'beta']);
    expect(found[0]?.hasBridge).toBe(true);
  });

  test('skips non-directory roots', () => {
    const sys = createFakeSystem();
    expect(scanProjects(sys, ['/missing'])).toEqual([]);
  });
});

describe('FileWatcher', () => {
  test('ignores configured folders and debounces', () => {
    const fw = new FileWatcher({ ignoredFolders: ['node_modules'], debounceMs: 100 });
    fw.onRaw('/r/node_modules/x.js', 0);
    expect(fw.pending).toBe(0);
    fw.onRaw('/r/.projectops/bridge/events/event-log.jsonl', 0);
    expect(fw.pending).toBe(1);
    expect(fw.flush(50)).toEqual([]);
    expect(fw.flush(100)).toEqual(['/r/.projectops/bridge/events/event-log.jsonl']);
  });

  test('isIgnored matches trailing folder', () => {
    const fw = new FileWatcher({ ignoredFolders: ['dist'], debounceMs: 0 });
    expect(fw.isIgnored('/r/dist')).toBe(true);
    expect(fw.isIgnored('/r/dist/a.js')).toBe(true);
    expect(fw.isIgnored('/r/src/a.js')).toBe(false);
  });
});
