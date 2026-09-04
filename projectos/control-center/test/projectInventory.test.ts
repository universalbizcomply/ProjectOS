/**
 * The installed-project inventory and selection boundary.
 *
 * Everything the daemon decides about WHICH project it governs lives in `projectInventory.ts`, and
 * every filesystem fact arrives as an input — so each refusal below is driven deliberately rather
 * than hoped for. Nothing here touches a real repository, a real registry or a real ProgramData.
 */
import { describe, expect, it } from 'vitest';
import {
  buildProjectInventory,
  decideSelection,
  toInventoryMessage,
  defaultSelection,
  normaliseRoot,
  parseProjectArgs,
  resolveProjectRoot,
  restoreSelection,
  serialiseSelection,
  type ProjectConfigReader,
} from '../src/governed/projectInventory';
import { ACTIVE_PHASE_STATUSES, WORK_IN_FLIGHT_STATUSES } from '../src/governed/governedProjection';

const ROOT_A = 'C:\\dev\\ProjectOS';
const ROOT_B = 'C:\\dev\\DeadAisle';

/** A synthetic machine: only the roots listed here have a project configuration. */
function reader(configs: Record<string, Record<string, unknown>>): ProjectConfigReader {
  return (root) => configs[root] ?? null;
}

const MACHINE = reader({
  [ROOT_A]: { projectId: 'projectos', projectName: 'ProjectOS', repo: 'universalbizcomply/ProjectOS' },
  [ROOT_B]: { projectId: 'dead-aisle', projectName: 'Dead Aisle', repo: 'murad/dead-aisle' },
});

/** Roots as the PACKAGED host supplies them: each bound to the id the registry recorded for it. */
function bound(roots: readonly string[]) {
  return roots.map((repositoryRoot) => ({
    boundProjectId: MACHINE(repositoryRoot)?.['projectId'] as string | undefined ?? null,
    repositoryRoot,
  }));
}

function inventoryOf(roots: readonly string[]) {
  return buildProjectInventory(bound(roots), MACHINE, 'ok');
}

/** Roots as a DEVELOPMENT run supplies them: no registry, so no bound identity. */
function unbound(roots: readonly string[]) {
  return roots.map((repositoryRoot) => ({ boundProjectId: null, repositoryRoot }));
}

describe('argv is the only channel, and it is parsed strictly', () => {
  it('separates the governed system root from project roots', () => {
    const args = parseProjectArgs([
      '--root',
      'C:\\ProgramData\\ProjectOS\\system',
      '--project-id',
      'projectos',
      '--project-root',
      ROOT_A,
      '--project-id',
      'dead-aisle',
      '--project-root',
      ROOT_B,
      '--project-registry-status',
      'ok',
    ]);
    expect(args.systemRoots).toEqual(['C:\\ProgramData\\ProjectOS\\system']);
    expect(args.suppliedProjects).toEqual([
      { boundProjectId: 'projectos', repositoryRoot: ROOT_A },
      { boundProjectId: 'dead-aisle', repositoryRoot: ROOT_B },
    ]);
    expect(args.registryStatus).toBe('ok');
  });

  /** A flag must never swallow the next flag as its value. */
  it('drops a flag whose value is missing or is itself a flag', () => {
    const args = parseProjectArgs(['--project-root', '--project-registry-status', 'ok', '--root']);
    expect(args.suppliedProjects).toEqual([]);
    expect(args.registryStatus).toBe('ok');
    expect(args.systemRoots).toEqual([]);
  });

  /**
   * ONE ID BINDS ONE ROOT. The id is consumed by the root that follows it and cleared; a second
   * root arriving without its own id is UNBOUND, never quietly given the previous root's identity —
   * which would let one registry entry vouch for a repository it was never validated against.
   */
  it('never lets one bound id carry over to a second root', () => {
    const args = parseProjectArgs([
      '--project-id',
      'projectos',
      '--project-root',
      ROOT_A,
      '--project-root',
      ROOT_B,
    ]);
    expect(args.suppliedProjects).toEqual([
      { boundProjectId: 'projectos', repositoryRoot: ROOT_A },
      { boundProjectId: null, repositoryRoot: ROOT_B },
    ]);
  });

  /** A status token outside the closed set is not believed. */
  it('refuses an unknown registry status token', () => {
    expect(parseProjectArgs(['--project-registry-status', 'everything-is-fine']).registryStatus).toBeNull();
    expect(parseProjectArgs([]).registryStatus).toBeNull();
  });
});

describe('[E1, E16] a validated project is selectable, and one project needs no choosing', () => {
  it('reads a single installed project and selects it by default', () => {
    const inventory = inventoryOf([ROOT_A]);
    expect(inventory.projects).toHaveLength(1);
    expect(inventory.projects[0]).toMatchObject({
      projectId: 'projectos',
      projectName: 'ProjectOS',
      repositoryRoot: ROOT_A,
      repository: 'universalbizcomply/ProjectOS',
    });
    expect(defaultSelection(inventory)).toBe('projectos');
  });

  /** With two, nothing is chosen for the owner: picking one would decide where their next action lands. */
  it('auto-selects nothing when more than one project is installed', () => {
    expect(defaultSelection(inventoryOf([ROOT_A, ROOT_B]))).toBeNull();
    expect(defaultSelection(inventoryOf([]))).toBeNull();
  });
});

describe('[E2, E3] a project id resolves only to its registered root, and never to a path', () => {
  it('resolves each id to its own root and unknown ids to nothing', () => {
    const inventory = inventoryOf([ROOT_A, ROOT_B]);
    expect(resolveProjectRoot(inventory, 'projectos')).toBe(ROOT_A);
    expect(resolveProjectRoot(inventory, 'dead-aisle')).toBe(ROOT_B);
    expect(resolveProjectRoot(inventory, 'PROJECTOS')).toBeNull();
    expect(resolveProjectRoot(inventory, 'projecto')).toBeNull();
    expect(resolveProjectRoot(inventory, '')).toBeNull();
  });

  /**
   * [E3] THE WEBVIEW CANNOT INJECT OR ASSERT A PATH. Selection takes an ID and looks it up; a value
   * that IS a path — absolute, relative, traversing, UNC, or one of the registered roots verbatim —
   * matches no id and selects nothing.
   */
  it('refuses every path-shaped selection', () => {
    const inventory = inventoryOf([ROOT_A, ROOT_B]);
    for (const attempt of [
      ROOT_A,
      'C:\\Windows\\System32',
      '..\\..\\ProjectOS',
      '\\\\attacker\\share\\repo',
      '/etc/passwd',
      'C:/dev/ProjectOS',
      'projectos\\..\\dead-aisle',
    ]) {
      expect(resolveProjectRoot(inventory, attempt)).toBeNull();
      expect(decideSelection(inventory, attempt, null, false)).toMatchObject({
        ok: false,
        code: 'UNKNOWN_PROJECT',
      });
    }
  });
});

describe('[E4, E5, E6] environment, working directory and relative configuration stay refused', () => {
  /**
   * The inventory's ONLY input is the roots it is handed. There is no parameter for an environment
   * variable, a working directory or a configuration file, so those are not refused — they are
   * unrepresentable. What IS representable, and refused, is a relative or traversing root.
   */
  it('refuses a relative, traversing or empty root', () => {
    const inventory = buildProjectInventory(
      unbound(['dev\\ProjectOS', '.', '..\\ProjectOS', 'C:\\dev\\..\\dev\\ProjectOS', '']),
      MACHINE,
      'ok',
    );
    expect(inventory.projects).toHaveLength(0);
    expect(inventory.refusals.map((r) => r.code)).toEqual([
      'NOT_ABSOLUTE',
      'NOT_ABSOLUTE',
      'NOT_ABSOLUTE',
      'TRAVERSAL',
      'NOT_ABSOLUTE',
    ]);
  });
});

describe('[E9, E11] a repository that is not what was registered fails closed', () => {
  it('drops a root with no readable project configuration', () => {
    const inventory = buildProjectInventory(
      unbound([ROOT_A, 'C:\\dev\\NotAProject']),
      MACHINE,
      'ok',
    );
    expect(inventory.projects.map((p) => p.projectId)).toEqual(['projectos']);
    expect(inventory.refusals.map((r) => r.code)).toEqual(['NO_PROJECT_CONFIG']);
  });

  it('drops a root whose configuration names no usable project', () => {
    const broken = reader({ [ROOT_A]: { projectName: 'no id here' } });
    const inventory = buildProjectInventory(unbound([ROOT_A]), broken, 'ok');
    expect(inventory.projects).toHaveLength(0);
    expect(inventory.refusals.map((r) => r.code)).toEqual(['MALFORMED_PROJECT_CONFIG']);
  });

  /**
   * [E11] The id is re-derived from the repository, never taken from argv. A repository re-badged
   * after registration therefore answers to its NEW id — and the old id selects nothing, rather than
   * silently continuing to resolve to a root that is no longer that project.
   */
  it('follows the repository, so a stale id selects nothing', () => {
    const renamed = reader({ [ROOT_A]: { projectId: 'projectos-renamed', projectName: 'Renamed' } });
    const inventory = buildProjectInventory(unbound([ROOT_A]), renamed, 'ok');
    expect(resolveProjectRoot(inventory, 'projectos')).toBeNull();
    expect(resolveProjectRoot(inventory, 'projectos-renamed')).toBe(ROOT_A);
  });
});

describe('[E10] duplicate ids and duplicate roots fail closed', () => {
  it('keeps the first and refuses a second entry claiming the same id', () => {
    const collide = reader({
      [ROOT_A]: { projectId: 'projectos' },
      [ROOT_B]: { projectId: 'projectos' },
    });
    const inventory = buildProjectInventory(unbound([ROOT_A, ROOT_B]), collide, 'ok');
    expect(inventory.projects).toHaveLength(1);
    expect(inventory.projects[0]?.repositoryRoot).toBe(ROOT_A);
    expect(inventory.refusals.map((r) => r.code)).toEqual(['DUPLICATE_PROJECT_ID']);
    // And the id still resolves to exactly ONE root — the first, never the impostor's.
    expect(resolveProjectRoot(inventory, 'projectos')).toBe(ROOT_A);
  });

  it('refuses the same root however it is spelled', () => {
    for (const spelling of [ROOT_A, 'c:\\dev\\projectos', 'C:/dev/ProjectOS', 'C:\\dev\\ProjectOS\\']) {
      const machine = reader({ [ROOT_A]: { projectId: 'projectos' }, [spelling]: { projectId: 'other' } });
      const inventory = buildProjectInventory(unbound([ROOT_A, spelling]), machine, 'ok');
      expect(inventory.projects).toHaveLength(1);
      expect(inventory.refusals.map((r) => r.code)).toEqual(['DUPLICATE_ROOT']);
    }
    expect(normaliseRoot('C:/dev/ProjectOS\\')).toBe(normaliseRoot(ROOT_A));
  });
});

describe('[E13] switching is refused while governed work is active', () => {
  const inventory = inventoryOf([ROOT_A, ROOT_B]);

  it('refuses a switch away from a project with an open phase', () => {
    const outcome = decideSelection(inventory, 'dead-aisle', 'projectos', true);
    expect(outcome).toMatchObject({ ok: false, code: 'GOVERNED_WORK_ACTIVE' });
    if (!outcome.ok) expect(outcome.detail).toContain('Finish or stop it before switching');
  });

  /** Re-selecting the project already selected changes nothing, so it is never refused. */
  it('allows re-selecting the current project even while work is open', () => {
    expect(decideSelection(inventory, 'projectos', 'projectos', true)).toMatchObject({
      ok: true,
      projectId: 'projectos',
      repositoryRoot: ROOT_A,
    });
  });

  it('allows a switch when nothing is open', () => {
    expect(decideSelection(inventory, 'dead-aisle', 'projectos', false)).toMatchObject({
      ok: true,
      repositoryRoot: ROOT_B,
    });
  });

  /** An unknown project is refused BEFORE the active-work question — it was never selectable. */
  it('refuses an unknown project whether or not work is open', () => {
    for (const active of [true, false]) {
      expect(decideSelection(inventory, 'not-installed', 'projectos', active)).toMatchObject({
        ok: false,
        code: 'UNKNOWN_PROJECT',
      });
    }
  });
});

describe('[E14] one project id resolves to one root, so nothing can cross projects', () => {
  /**
   * Plans, current state, execution state, Owner Chat, worker context, evidence and approval state
   * are all read from and written to `<repositoryRoot>/.projectops/...` by the canonical runtime. The
   * mechanism that separates them is therefore this: two projects never share a root, and a project
   * id resolves to exactly one. Both halves are asserted here, because if either failed, everything
   * downstream would silently be reading another project's records.
   */
  it('gives every project a distinct root and every id exactly one', () => {
    const inventory = inventoryOf([ROOT_A, ROOT_B]);
    const roots = inventory.projects.map((p) => normaliseRoot(p.repositoryRoot));
    expect(new Set(roots).size).toBe(roots.length);
    const ids = inventory.projects.map((p) => p.projectId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const project of inventory.projects) {
      expect(resolveProjectRoot(inventory, project.projectId)).toBe(project.repositoryRoot);
    }
    // And no id resolves into another project's tree.
    expect(resolveProjectRoot(inventory, 'projectos')).not.toBe(ROOT_B);
    expect(resolveProjectRoot(inventory, 'dead-aisle')).not.toBe(ROOT_A);
  });
});

describe('[E15] the selection survives a restart, and only while it is still valid', () => {
  const inventory = inventoryOf([ROOT_A, ROOT_B]);

  it('round-trips through the persisted record', () => {
    const text = serialiseSelection('dead-aisle');
    expect(text.endsWith('\n')).toBe(true);
    expect(restoreSelection(text, inventory)).toBe('dead-aisle');
  });

  /** A remembered id is re-resolved against THIS run's inventory, never trusted on its own. */
  it('restores nothing when the remembered project is no longer available', () => {
    const text = serialiseSelection('dead-aisle');
    expect(restoreSelection(text, inventoryOf([ROOT_A]))).toBeNull();
  });

  it('restores nothing from a missing, malformed or wrong-version record', () => {
    for (const text of [
      null,
      '',
      '   ',
      'not json',
      '[]',
      '{"projectId":"projectos"}',
      '{"schemaVersion":2,"projectId":"projectos"}',
      '{"schemaVersion":1,"projectId":""}',
      '{"schemaVersion":1,"projectId":123}',
    ]) {
      expect(restoreSelection(text, inventory)).toBeNull();
    }
  });

  /** A BOM is what a Windows editor leaves behind; it must not read as corruption. */
  it('tolerates a byte-order mark', () => {
    expect(restoreSelection('\ufeff' + serialiseSelection('projectos'), inventory)).toBe('projectos');
  });
});

describe('[E3, E11] a repository cannot rename itself into another project', () => {
  /**
   * THE FINDING THIS TEST EXISTS FOR. Deriving identity from the repository alone let a repository
   * with ordinary write access re-badge itself as a SIBLING project: processed first, it won the id,
   * the real sibling was dropped as a duplicate, and the owner's unchanged selection silently
   * started resolving to the impostor's tree. The registry-bound id makes the impostor disappear
   * instead.
   */
  it('refuses a root whose repository now claims a sibling project id', () => {
    const impostor = reader({
      [ROOT_A]: { projectId: 'dead-aisle', projectName: 'Impostor' },
      [ROOT_B]: { projectId: 'dead-aisle', projectName: 'Dead Aisle', repo: 'murad/dead-aisle' },
    });
    const inventory = buildProjectInventory(
      [
        { boundProjectId: 'projectos', repositoryRoot: ROOT_A },
        { boundProjectId: 'dead-aisle', repositoryRoot: ROOT_B },
      ],
      impostor,
      'ok',
    );
    expect(inventory.refusals.map((r) => r.code)).toEqual(['PROJECT_ID_MISMATCH']);
    expect(inventory.projects).toHaveLength(1);
    // The REAL dead-aisle survives, at its own root — not the impostor's.
    expect(resolveProjectRoot(inventory, 'dead-aisle')).toBe(ROOT_B);
    expect(resolveProjectRoot(inventory, 'projectos')).toBeNull();
  });

  /** An id the selection channel could never name is not offered at all. */
  it('refuses a project whose own configuration declares an unselectable id', () => {
    for (const projectId of ['has space', '-force', '.hidden', 'has/slash', 'a'.repeat(300)]) {
      const odd = reader({ [ROOT_A]: { projectId } });
      const inventory = buildProjectInventory(
        [{ boundProjectId: projectId, repositoryRoot: ROOT_A }],
        odd,
        'ok',
      );
      expect(inventory.projects, projectId).toHaveLength(0);
      expect(inventory.refusals.map((r) => r.code)).toEqual(['UNSELECTABLE_PROJECT_ID']);
    }
  });

  /** A development run has no registry and therefore no bound id; the repository is believed. */
  it('accepts an unbound root in a development run', () => {
    const inventory = buildProjectInventory(unbound([ROOT_A]), MACHINE, null);
    expect(inventory.projects.map((p) => p.projectId)).toEqual(['projectos']);
    expect(inventory.registryStatus).toBeNull();
  });

  /** A duplicated root is claimed the moment it is recognised, whatever the reader does next. */
  it('never evaluates the same root twice, even if the reader changes its answer', () => {
    let call = 0;
    const flapping = (root: string) => {
      call += 1;
      return root === ROOT_A ? { projectId: call === 1 ? 'projectos' : 'something-else' } : null;
    };
    const inventory = buildProjectInventory(unbound([ROOT_A, ROOT_A]), flapping, 'ok');
    expect(inventory.projects).toHaveLength(1);
    expect(inventory.refusals.map((r) => r.code)).toEqual(['DUPLICATE_ROOT']);
  });
});

describe('the wire shape comes from one declaration', () => {
  it('carries a count of refusals, never the reasons', () => {
    const inventory = buildProjectInventory(
      unbound([ROOT_A, 'C:\\dev\\NotAProject', 'relative\\path']),
      MACHINE,
      'ok',
    );
    const message = toInventoryMessage(inventory, 'projectos');
    expect(message.selectedProjectId).toBe('projectos');
    expect(message.registryStatus).toBe('ok');
    expect(message.refusedCount).toBe(2);
    expect(message.projects.map((p) => p.projectId)).toEqual(['projectos']);
    expect(Object.keys(message).sort()).toEqual([
      'projects',
      'refusedCount',
      'registryStatus',
      'selectedProjectId',
    ]);
  });
});

describe('a step waiting on the owner does not lock the project', () => {
  it('WORK_IN_FLIGHT_STATUSES excludes awaiting_closure, and nothing else', () => {
    // Two different questions were being answered by one list. "Which phase is current" must
    // include awaiting_closure -- the screen has to show it and hold it. "Is work in flight, so a
    // switch would strand it" must not: the run finished, the loop refuses to touch it, and there
    // is no worker or half-written evidence behind it.
    expect(ACTIVE_PHASE_STATUSES).toContain('awaiting_closure');
    expect(WORK_IN_FLIGHT_STATUSES).not.toContain('awaiting_closure');
    // Conservative everywhere else: any of these can have a live worker behind it.
    for (const s of ['draft', 'prompted', 'implementing', 'validating', 'evidence', 'awaiting_review']) {
      expect(WORK_IN_FLIGHT_STATUSES).toContain(s);
    }
    expect(WORK_IN_FLIGHT_STATUSES.length).toBe(ACTIVE_PHASE_STATUSES.length - 1);
  });

  it('terminal statuses were never in flight and still are not', () => {
    for (const s of ['closed', 'closed_as_blocked', 'rolled_back', 'not-started']) {
      expect(WORK_IN_FLIGHT_STATUSES).not.toContain(s);
    }
  });
});
