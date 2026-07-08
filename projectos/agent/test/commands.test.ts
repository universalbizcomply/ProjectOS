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

  it('refuses to overwrite an existing install without --force', () => {
    const { ctx } = makeCtx();
    run(ctx, ['install', '--target', '/proj', '--id', 'x']);
    expect(run(ctx, ['install', '--target', '/proj', '--id', 'x']).code).toBe(2);
    expect(run(ctx, ['install', '--target', '/proj', '--id', 'x', '--force']).code).toBe(0);
  });
});

describe('phase runtime', () => {
  it('new creates a persisted draft phase', () => {
    const { ctx, sys } = makeCtx();
    const r = run(ctx, ['phase', 'new', '--id', 'RT1A', '--project', 'ProjectOS']);
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('status: draft');
    expect(sys.exists('/repo/.projectops/phases/RT1A.json')).toBe(true);
  });

  it('new requires --id and refuses overwrite without --force', () => {
    const { ctx } = makeCtx();
    expect(run(ctx, ['phase', 'new']).code).toBe(1);
    run(ctx, ['phase', 'new', '--id', 'RT1A']);
    expect(run(ctx, ['phase', 'new', '--id', 'RT1A']).code).toBe(2);
    expect(run(ctx, ['phase', 'new', '--id', 'RT1A', '--force']).code).toBe(0);
  });

  it('advances along the happy path and records history', () => {
    const { ctx } = makeCtx();
    run(ctx, ['phase', 'new', '--id', 'RT1A']);
    for (const to of ['prompted', 'implementing', 'validating', 'evidence', 'awaiting_review', 'awaiting_closure']) {
      const r = run(ctx, ['phase', 'advance', '--id', 'RT1A', '--to', to]);
      expect(r.code).toBe(0);
    }
    const show = run(ctx, ['phase', 'show', '--id', 'RT1A']);
    expect(show.lines.join('\n')).toContain('status:    awaiting_closure');
    expect(show.lines.join('\n')).toContain('-> prompted');
  });

  it('rejects illegal transitions with exit 1', () => {
    const { ctx } = makeCtx();
    run(ctx, ['phase', 'new', '--id', 'RT1A']);
    const r = run(ctx, ['phase', 'advance', '--id', 'RT1A', '--to', 'closed', '--as', 'owner']);
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('Illegal transition');
  });

  it('blocks non-owner closure with exit 2 but allows owner', () => {
    const { ctx } = makeCtx();
    run(ctx, ['phase', 'new', '--id', 'RT1A']);
    for (const to of ['prompted', 'implementing', 'validating', 'evidence', 'awaiting_review', 'awaiting_closure']) {
      run(ctx, ['phase', 'advance', '--id', 'RT1A', '--to', to]);
    }
    const blocked = run(ctx, ['phase', 'advance', '--id', 'RT1A', '--to', 'closed', '--as', 'implementer']);
    expect(blocked.code).toBe(2);
    expect(blocked.lines.join('\n')).toContain("requires role 'owner'");
    const owned = run(ctx, ['phase', 'advance', '--id', 'RT1A', '--to', 'closed', '--as', 'owner', '--note', 'accepted']);
    expect(owned.code).toBe(0);
    expect(run(ctx, ['phase', 'show', '--id', 'RT1A']).lines.join('\n')).toContain('accepted');
  });

  it('validates flags and status names', () => {
    const { ctx } = makeCtx();
    run(ctx, ['phase', 'new', '--id', 'RT1A']);
    expect(run(ctx, ['phase', 'advance', '--id', 'RT1A']).code).toBe(1);
    expect(run(ctx, ['phase', 'advance', '--id', 'RT1A', '--to', 'bogus']).code).toBe(1);
    expect(run(ctx, ['phase', 'advance', '--id', 'RT1A', '--to', 'prompted', '--as', 'wizard']).code).toBe(1);
    expect(run(ctx, ['phase', 'advance', '--id', 'MISSING', '--to', 'prompted']).code).toBe(1);
  });

  it('list and show handle empty/missing gracefully', () => {
    const { ctx } = makeCtx();
    expect(run(ctx, ['phase', 'list']).lines.join('\n')).toContain('No phases');
    expect(run(ctx, ['phase', 'show', '--id', 'X']).code).toBe(1);
    run(ctx, ['phase', 'new', '--id', 'A']);
    run(ctx, ['phase', 'new', '--id', 'B']);
    expect(run(ctx, ['phase', 'list']).lines.join('\n')).toContain('2 phase(s)');
  });

  it('rejects unknown subcommands', () => {
    const { ctx } = makeCtx();
    expect(run(ctx, ['phase', 'frob']).code).toBe(1);
  });
});

describe('approve loop', () => {
  it('gated request must be decided by owner; non-owner blocked (exit 2)', () => {
    const { ctx } = makeCtx();
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
    const { ctx } = makeCtx();
    run(ctx, ['approve', 'request', '--id', 'FP', '--action', 'force push to main']);
    expect(run(ctx, ['approve', 'decide', '--id', 'FP', '--decision', 'approved', '--as', 'owner']).code).toBe(2);
    expect(run(ctx, ['approve', 'decide', '--id', 'FP', '--decision', 'approved', '--as', 'owner', '--override']).code).toBe(0);
  });

  it('ungated action can be self-decided by the requester', () => {
    const { ctx } = makeCtx();
    run(ctx, ['approve', 'request', '--id', 'R1', '--action', 'refactor a helper', '--as', 'implementer']);
    expect(run(ctx, ['approve', 'decide', '--id', 'R1', '--decision', 'approved', '--as', 'implementer']).code).toBe(0);
  });

  it('validates flags and missing records', () => {
    const { ctx } = makeCtx();
    expect(run(ctx, ['approve', 'request', '--id', 'X']).code).toBe(1);
    expect(run(ctx, ['approve', 'request', '--action', 'x']).code).toBe(1);
    expect(run(ctx, ['approve', 'decide', '--id', 'X', '--decision', 'maybe', '--as', 'owner']).code).toBe(1);
    expect(run(ctx, ['approve', 'decide', '--id', 'MISSING', '--decision', 'approved', '--as', 'owner']).code).toBe(1);
  });

  it('refuses duplicate request without --force; list/show handle empty', () => {
    const { ctx } = makeCtx();
    expect(run(ctx, ['approve', 'list']).lines.join('\n')).toContain('No approvals');
    run(ctx, ['approve', 'request', '--id', 'A1', '--action', 'deploy to prod']);
    expect(run(ctx, ['approve', 'request', '--id', 'A1', '--action', 'x']).code).toBe(2);
    expect(run(ctx, ['approve', 'list']).lines.join('\n')).toContain('1 approval(s)');
    expect(run(ctx, ['approve', 'frob']).code).toBe(1);
    expect(run(ctx, ['approve', 'show', '--id', 'NOPE']).code).toBe(1);
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
