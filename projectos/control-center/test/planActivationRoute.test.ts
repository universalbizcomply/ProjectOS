/**
 * THE OWNER-UI ACTIVATION ROUTE, joined end to end (OWNER-WORKFLOW-PLAN-ACTIVATION1A).
 *
 * This lives HERE, not in the agent's suite, and the reason is a real build rule rather than taste.
 * `control-center` depends on `@projectos/agent`; the agent depends on nothing here. An earlier
 * version of this test sat in `agent/test/` and reached back across the boundary with a relative
 * path, which ran green under vitest — vitest strips types — while breaking the agent's dedicated
 * `typecheck:tests` guard with a rootDir violation. The dependency direction is the fix.
 *
 * WHAT IT PROVES. The browser sends a `plan.activate` request; the boundary validates and maps it;
 * the resulting invocation is handed to the REAL `plan` command exported by the agent, which calls
 * the REAL `approvePlan`. No shape is restated by hand, so the two halves cannot drift apart: rename
 * a flag in the mapping and this fails immediately.
 *
 * WHAT IT DOES NOT PROVE, deliberately. The happy path — a valid committed decision materialising a
 * plan and recomputing PLAN READY — needs a governed temp repository with committed delegation,
 * decision, draft and active plan. That fixture exists in `agent/test/planApproval.test.ts` and
 * proves it there against the engine directly. Rebuilding it here to prove the same thing twice
 * would duplicate ~200 lines of harness to add nothing; what is missing on that side is only the
 * mapping, and that is exactly what this covers.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plan as planCommand } from '@projectos/agent';
import {
  validateGovernedCommand,
  toAgentInvocation,
  GOVERNED_COMMAND_KIND,
} from '../src/governed/governedCommands.js';

const created: string[] = [];
afterEach(() => {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The exact invocation the browser boundary produces — built BY the boundary, never restated. */
function browserRoute(draftId: string, decisionId: string) {
  const checked = validateGovernedCommand({
    kind: GOVERNED_COMMAND_KIND,
    verb: 'plan.activate',
    args: { draftId, decisionId },
    correlationId: 'c-activate',
  });
  if (!checked.ok) throw new Error(`the boundary refused a well-formed request: ${checked.code}`);
  const inv = toAgentInvocation(checked.request);
  if (inv === null) throw new Error('plan.activate must map to an invocation');
  return inv;
}

/** A bare project root: no governance records at all, so activation must refuse. */
function emptyRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'projectos-activate-')).split(String.fromCharCode(92)).join('/');
  created.push(root);
  mkdirSync(join(root, '.projectops'), { recursive: true });
  writeFileSync(
    join(root, '.projectops', 'project-config.json'),
    JSON.stringify({ projectId: 'acme', owner: 'Ada', localPath: root }, null, 2),
  );
  return root;
}

const sys = {
  cwd: () => process.cwd(),
  now: () => '2026-08-13T00:00:00.000Z',
  readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
  writeText: (p: string, c: string) => {
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, c);
  },
  exists: (p: string) => existsSync(p),
  listDir: () => [],
  exec: () => ({ code: 1, stdout: '', stderr: 'not a repository' }),
};

describe('the browser activation route reaches the canonical plan command', () => {
  test('the boundary maps plan.activate to the real `plan activate` invocation', () => {
    const inv = browserRoute('draft-20260813-a1b2c3', 'PROJECTOS-DECISION1A');
    expect(inv.command).toBe('plan');
    // `activate`, not `approve`: the low-level command's single fixed destination would make this
    // button usable exactly once per project.
    expect(inv.positionals).toEqual(['activate']);
    expect(Object.keys(inv.flags).sort()).toEqual(['decision', 'id']);
  });

  test('that invocation drives the REAL command, which refuses without an approval', () => {
    const root = emptyRoot();
    const inv = browserRoute('draft-20260813-a1b2c3', 'PROJECTOS-DECISION1A');

    // The agent's own exported command — not a copy, not a stub.
    const r = planCommand({ sys, root }, inv.flags, inv.positionals);

    // A canonical refusal, in the runtime's words. Reaching this proves the mapping landed on an
    // activation command and not, say, `plan draft`, which would have produced a draft instead.
    //
    // IT ALSO CATCHES A STALE BUILD. This package resolves `@projectos/agent` to that package's
    // BUILT output, so a `dist` compiled before the `activate` subcommand existed would answer
    // "Unknown 'plan' subcommand: activate" — which does not match /REFUSED/ and fails here. Do not
    // relax this to a generic "non-zero exit" check: that is exactly what would let a stale dist
    // pass while the source it claims to test had moved on.
    expect(r.code).not.toBe(0);
    expect(r.lines.join(' ')).toMatch(/REFUSED/);
    // And nothing was written.
    expect(existsSync(join(root, '.projectops/plan.json'))).toBe(false);
  });

  test('a mis-mapped verb could not produce that refusal — plan.draft goes elsewhere', () => {
    const checked = validateGovernedCommand({
      kind: GOVERNED_COMMAND_KIND,
      verb: 'plan.draft',
      args: { objective: 'Make the ordering journey reliable and simple to operate.' },
      correlationId: 'c-draft',
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const inv = toAgentInvocation(checked.request)!;
    expect(inv.positionals).toEqual(['draft']);
    expect(inv.positionals).not.toEqual(['activate']);
  });
});
