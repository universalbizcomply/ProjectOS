/**
 * THE EXISTING SIGNED BROKER TRANSPORTS THE HOST-AUTHORED REQUEST — UNCHANGED (PROJECTOS-HOST-REVIEW-PATH1B).
 *
 * The gatekeeper ruled that the ProjectOSHost, not the agent and not the broker, authors the unattended
 * review's provider request, and that the broker should stay byte-unchanged IF its existing contract can
 * carry a Host-built body. This is that "if", run rather than argued:
 *
 *   - the BODY is the one the REAL Rust Host authored, recorded in the committed cross-language vector
 *     file by the Host's own vector run (`hostProviderRequestBody`);
 *   - the BROKER is the repository's real `gatekeeper-transport-broker.cjs`, read from disk, committed
 *     into a disposable installation and run by the production transport, exactly as live;
 *   - nothing about the broker is stubbed, and no provider can be reached: the vector's candidate commit
 *     does not exist in a disposable repository, so the broker stops at its LAST gate before spend.
 *
 * REACHING THAT GATE IS THE PROOF. The broker checks, in order: the body's bindings at their fixed
 * positions and its request id; that the installation authorises the project; that the owner approved
 * the phase; that the ask is one ProjectOS asks; and only then that the commit exists. A Host-built body
 * that the broker's contract could not carry would be refused at the FIRST of those, as the negative
 * controls below are.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { System } from '../src/system.js';
import { nodeBrokeredTransport, TRANSPORT_BROKER_REL, type BrokeredTransport } from '../src/loop/transports/brokeredHttpPort.js';

const V = JSON.parse(readFileSync(join(__dirname, '..', '..', 'contracts', 'host-review-path-vectors.v1.json'), 'utf8')) as {
  inputs: Record<string, string>;
  host: { attested: { ask: 'gatekeeper' | 'closure'; hostProviderRequestBody: string }[] };
};
const I = V.inputs;
const BROKER_ASK = { gatekeeper: 'evidence-review', closure: 'closure-review' } as const;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function nodeLikeSystem(): System {
  return {
    cwd: () => process.cwd(),
    now: () => '2026-09-20T00:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: (cmd: string, args: readonly string[], options?: { cwd?: string }) => {
      try {
        const stdout = execFileSync(cmd, [...args], { encoding: 'utf8', ...(options?.cwd === undefined ? {} : { cwd: options.cwd }), stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stdout, stderr: '' };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
      }
    },
  } as System;
}

/** A disposable installation that authorises the vector's project and phase, holding the REAL broker. */
function authorisedInstallation(): { root: string; stateDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'projectos-hostbody-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'projectos-hostbody-state-'));
  dirs.push(root, stateDir);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', 'https://github.com/local/fixture.git');
  const write = (rel: string, text: string) => {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
  };
  // THE REAL BROKER, byte for byte as the repository holds it.
  write(TRANSPORT_BROKER_REL, readFileSync(join(__dirname, '..', '..', 'security', 'gatekeeper-transport-broker.cjs'), 'utf8'));
  write(
    'projectos/security/installation-project-allowlist.json',
    JSON.stringify({
      schemaVersion: '1.0.0',
      projects: [{ projectId: I['projectId'], repository: 'github.com/local/fixture', governedRoot: root.split(String.fromCharCode(92)).join('/') }],
    }),
  );
  write(`.projectops/gates/${I['phaseId']}.secrets-handling.json`, JSON.stringify({ gateName: 'secrets-handling', phaseId: I['phaseId'], ownerChoice: 'APPROVE' }));
  git('add', '-A');
  git('commit', '-q', '-m', 'authorised');
  return { root, stateDir };
}

function askBroker(world: { root: string; stateDir: string }, ask: 'gatekeeper' | 'closure', body: string, over: Partial<Record<string, string>> = {}): string {
  const previous = process.env['LOCALAPPDATA'];
  process.env['LOCALAPPDATA'] = world.stateDir;
  try {
    const transport = nodeBrokeredTransport(nodeLikeSystem(), { installRoot: world.root, adapterRelPath: 'projectos/credentials/x.ps1' });
    const requestId = body.match(/requestId: ([^\\\n"]+)/)?.[1] ?? '';
    const r = transport.post({
      kind: 'gatekeeper',
      governedRoot: world.root,
      projectId: I['projectId']!,
      phaseId: I['phaseId']!,
      subjectCommit: I['subjectCommit']!,
      ask: BROKER_ASK[ask],
      requestId,
      credentialRef: I['credentialRef']!,
      body,
      ...over,
    } as Parameters<BrokeredTransport['post']>[0]);
    return r.kind === 'response' ? r.body : JSON.stringify(r);
  } finally {
    if (previous === undefined) delete process.env['LOCALAPPDATA'];
    else process.env['LOCALAPPDATA'] = previous;
  }
}

describe('the byte-unchanged broker carries the body the real Host authored', () => {
  it.each(V.host.attested.map((x) => [x.ask, x] as const))(
    'the %s body passes the binding check, both authority factors and the ask vocabulary',
    (_ask, exchange) => {
      expect(exchange.hostProviderRequestBody.length).toBeGreaterThan(0);
      const said = askBroker(authorisedInstallation(), exchange.ask, exchange.hostProviderRequestBody);
      // THE LAST GATE BEFORE SPEND: everything about the Host-built body was accepted, and the only
      // thing wrong is that a disposable repository does not contain the vector's candidate commit.
      expect(said).toContain(`the governed repository contains no commit ${I['subjectCommit']}`);
      // ...so none of the EARLIER refusals fired.
      expect(said).not.toMatch(/cannot be bound|states no |is for (project|phase|subject|ask)|more than once|does not open with the request id|not a question ProjectOS asks/);
    },
  );

  it('NEGATIVE CONTROLS: the same broker refuses a body that is not the authorised one, at the FIRST gate', () => {
    const exchange = V.host.attested.find((x) => x.ask === 'gatekeeper')!;
    const world = authorisedInstallation();
    const body = exchange.hostProviderRequestBody;

    // The body is bound to the vector's project; told it is for another, the broker refuses the binding.
    expect(askBroker(world, 'gatekeeper', body, { projectId: 'some-other-project' })).toMatch(/is for project/);
    // A body re-pointed at another candidate no longer matches what the broker was separately told.
    const repointed = body.split(I['subjectCommit']!).join('7e15629506400000000000000000000000000000');
    expect(repointed).not.toBe(body);
    expect(askBroker(world, 'gatekeeper', repointed)).toMatch(/is for subject/);
    // A second, contradicting binding line is ambiguity, and is refused rather than resolved.
    const doubled = body.replace('  ask:     evidence-review', '  ask:     evidence-review\\n  ask:     security-review');
    expect(doubled).not.toBe(body);
    expect(askBroker(world, 'gatekeeper', doubled)).toMatch(/more than once/);
    // The technical body asked as a closure question does not match the ask it states.
    expect(askBroker(world, 'closure', body)).toMatch(/is for ask/);
  });

  it('the Host, not the agent, chose the model and wrote the instructions and the schema', () => {
    for (const exchange of V.host.attested) {
      const body = JSON.parse(exchange.hostProviderRequestBody) as {
        model: string;
        instructions: string;
        input: { content: { text: string }[] }[];
        text: { format: { name: string; strict: boolean; schema: { additionalProperties: boolean } } };
      };
      // The model the fixture owner policy names - not anything in the agent's subject.
      expect(body.model).toBe('gpt-5.6-terra');
      expect(body.instructions.startsWith('You are the independent ProjectOS reviewer.')).toBe(true);
      expect(body.instructions).toContain('JUDGE THE HOST-ESTABLISHED EVIDENCE');
      expect(body.text.format.strict).toBe(true);
      expect(body.text.format.schema.additionalProperties).toBe(false);
      const text = body.input[0]!.content[0]!.text;
      expect(text).toContain('template: projectos.host-review-request.v1');
      // The Host's evidence comes first; the agent's bytes are present only as a labelled claim.
      const established = text.indexOf('----- BEGIN HOST-ESTABLISHED ');
      const claimed = text.indexOf('----- BEGIN AGENT-CLAIMED NOT HOST VERIFIED ');
      expect(established).toBeGreaterThan(0);
      expect(claimed).toBeGreaterThan(established);
      expect(text.slice(established, claimed)).toContain(`candidate-commit: ${I['subjectCommit']}`);
    }
  });
});
