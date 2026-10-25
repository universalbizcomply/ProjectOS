/**
 * THERE IS ONE OWNER WORKFLOW, AND THE SECOND ONE IS NOT REACHABLE.
 *
 * Owner Control was a complete parallel owner console living behind Advanced: its own project
 * picker, its own add-project path, its own objective intake, its own spend panel, and its own run
 * console that fired `run.start` — real money, a real worker — from a single unconfirmed click.
 * Every one of those jobs is done by the accepted UI, so keeping it meant the product answered the
 * same question twice, in two different ways, with two different safety postures.
 *
 * The ruling was to RETIRE it rather than add confirmation and keep it. Its owner-facing route is
 * gone. The modules remain on disk — deleting them is a separate decision, and the governance
 * validator for the protected-confirmation framework still reads one of them — but nothing in the
 * product reaches them, which is what "retired" has to mean to be worth anything.
 *
 * WHAT WAS PRESERVED, and why only this: the per-credential technical identity — reference,
 * environment, risk class, fingerprint, expiry — appears on no other surface. Settings manages keys
 * and Health reports their status; neither prints what identifies one. It moved to Advanced as
 * read-only evidence, without the workflow that used to surround it.
 *
 * Asserted against the REAL module graph from `src/main.tsx`, because reachability is the whole
 * claim and a rule proven once by reading the source is a rule that quietly breaks later.
 *
 * Created in PROJECTOS-CONTROL-CENTER-INTEGRATION1A.
 */
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const rel = (p: string): string => p.slice(SRC.length + 1).replace(/\\/g, '/');
const ALL = new Map(sourceFiles(SRC).map((p) => [rel(p), readFileSync(p, 'utf8')]));

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = posix.join(posix.dirname(from), spec).replace(/\.js$/, '');
  for (const c of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (ALL.has(c)) return c;
  }
  return null;
}

/** Every module the shipped entry point can actually reach. */
const REACHABLE: ReadonlySet<string> = (() => {
  const seen = new Set<string>();
  const stack = ['main.tsx'];
  while (stack.length > 0) {
    const f = stack.pop();
    if (f === undefined || seen.has(f)) continue;
    seen.add(f);
    const text = ALL.get(f) ?? '';
    for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      const r = resolve(f, m[1] as string);
      if (r !== null) stack.push(r);
    }
    for (const m of text.matchAll(/import\(\s*["']([^"']+)["']/g)) {
      const r = resolve(f, m[1] as string);
      if (r !== null) stack.push(r);
    }
  }
  return seen;
})();

/** The parallel console, module by module. */
const SECOND_WORKFLOW: readonly string[] = [
  'owner/OwnerControlPlane.tsx',
  'owner/GovernedActions.tsx',
  'owner/ObjectiveIntake.tsx',
  'owner/ProjectSelector.tsx',
  'owner/RegisterProjectGuide.tsx',
  'owner/GatekeeperStatus.tsx',
];

describe('the second owner workflow is unreachable', () => {
  test.each(SECOND_WORKFLOW)('%s is not reachable from the shipped entry point', (module) => {
    expect(ALL.has(module)).toBe(true); // still on disk — retiring is not deleting
    expect(REACHABLE.has(module)).toBe(false);
  });

  test('nothing in the product renders Owner Control', () => {
    const renders = [...ALL.entries()]
      .filter(([f, t]) => f !== 'owner/OwnerControlPlane.tsx' && /<OwnerControlPlane\b/.test(t))
      .map(([f]) => f);
    expect(renders).toEqual([]);
  });

  test('the Advanced surface list no longer offers it', () => {
    const app = ALL.get('App.tsx') ?? '';
    expect(app).not.toMatch(/label: 'Owner Control'/);
    expect(app).not.toMatch(/OwnerControlPlane/);
  });
});

describe('no reachable module dispatches phase mutation or a manual refresh', () => {
  /**
   * `phase.*` and `refresh` were Owner Control's alone. The accepted architecture is explicit that
   * closing work is not done in the product — the Control Center refuses it in those words — and
   * governed state is pushed after every command rather than pulled by a button. They remain in the
   * runtime's vocabulary and in the CLI; what is gone is a second console for them.
   */
  test.each(['phase.start', 'phase.stop', 'phase.resume', 'phase.close', 'phase.advance', 'refresh'])(
    '%s appears in no reachable module except the verb vocabulary itself',
    (verb) => {
      const dispatchers = [...REACHABLE]
        .filter((f) => f !== 'governed/governedCommands.ts')
        .filter((f) => new RegExp(`'${verb.replace('.', '\\.')}'`).test(ALL.get(f) ?? ''));
      expect(dispatchers).toEqual([]);
    },
  );
});

describe('the credential evidence survived the retirement', () => {
  test('Advanced reaches the technical Connections projection', () => {
    expect(REACHABLE.has('owner/ConnectionsPanel.tsx')).toBe(true);
    const app = ALL.get('App.tsx') ?? '';
    expect(app).toMatch(/label: 'Connections \(technical\)'/);
    expect(app).toMatch(/<ConnectionsPanel/);
  });

  test('it is still the read-only projection, not a second management surface', () => {
    const panel = ALL.get('owner/ConnectionsPanel.tsx') ?? '';
    expect(panel).toMatch(/mode="technical"/);
    expect(panel).not.toMatch(/mode="manage"/);
  });
});

describe('one surface per owner job', () => {
  test.each([
    ['project selection', /'project\.select'/],
    ['objective intake', /'plan\.draft'/],
  ])('%s is dispatched from exactly one reachable module', (_job, verb) => {
    const dispatchers = [...REACHABLE]
      .filter((f) => f !== 'governed/governedCommands.ts')
      .filter((f) => verb.test(ALL.get(f) ?? ''));
    expect(dispatchers.length).toBe(1);
  });
});
