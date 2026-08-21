/**
 * The agent's side of the trusted transport: verify the broker's bytes, then run THOSE BYTES.
 *
 * WHAT THIS DOES NOT CARRY. No credential, no header, no endpoint. It hands the broker a request and
 * the identity of the project the call is for, and reads back a status and a body. The value the call
 * is authenticated with never exists in this process, so there is nothing here for a leak to find.
 *
 * EXECUTING BYTES, NOT A PATH. The broker source is read from the installation's git object store,
 * compared with the working-tree copy, and passed to `node -e`. Verifying a path and then executing
 * that path leaves a window in which the two can differ — the verify-then-spawn race an adversarial
 * review raised. There is no window here: what was verified is the string that runs.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A under the gatekeeper ruling of 2026-08-20
 * (HIGH-2, trusted credential boundary).
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { System } from '../../system.js';
import type { ProjectosRuntime } from '../../nodeRuntimeRoot.js';
import type { HttpResponse } from './openaiResponses.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolveBoundGit } from '../../system.js';
import { nodeInstallationStateDir } from '../../nodeRuntimeRoot.js';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Where the trusted broker lives, relative to the installation root. */
export const TRANSPORT_BROKER_REL = 'projectos/security/gatekeeper-transport-broker.cjs';

export interface BrokeredCall {
  readonly governedRoot: string;
  readonly projectId: string;
  readonly phaseId: string;
  /**
   * The rest of what this call is bound to, declared SEPARATELY from the body.
   *
   * The trusted side compares these against the fields it reads out of the body at their own
   * positions. Declaring them apart from the payload is what makes that a comparison rather than a
   * search: the caller has to say what it claims the call is for, and then be held to it.
   */
  readonly subjectCommit: string;
  readonly ask: string;
  readonly requestId: string;
  readonly credentialRef: string;
  readonly body: string;
  readonly timeoutMs?: number;
}

/**
 * A transport that asks the installation to make the call.
 *
 * `post` returns the same `HttpResponse` shape the direct port returns, so everything downstream —
 * the decision parser, the binding checks, the ledger — is unchanged.
 */
export interface BrokeredTransport {
  post(call: BrokeredCall): HttpResponse;
}

/**
 * The broker's source, proven to be the installation's committed source.
 *
 * Returns the bytes on success and `null` on any doubt: not committed, changed in the working tree,
 * unreadable, or different from the object. A broker whose provenance cannot be established is not
 * run — and because the caller executes exactly these bytes, "established" means established for the
 * code that actually runs.
 */
export function verifiedBrokerSource(sys: System, runtime: ProjectosRuntime): string | null {
  const rel = TRANSPORT_BROKER_REL;
  const install = runtime.installRoot;

  const logged = sys.exec('git', ['-C', install, 'log', '-1', '--format=%H', '--', rel]);
  if (logged.code !== 0 || logged.stdout.trim().length === 0) return null;
  const dirty = sys.exec('git', ['-C', install, 'diff', '--name-only', 'HEAD', '--', rel]);
  if (dirty.code !== 0 || dirty.stdout.trim().length > 0) return null;
  const shown = sys.exec('git', ['-C', install, 'show', `HEAD:./${rel}`]);
  if (shown.code !== 0 || shown.stdout.trim().length === 0) return null;

  const onDisk = sys.readText(join(install, ...rel.split('/')));
  if (onDisk === null) return null;
  const strip = (t: string): string => t.split(String.fromCharCode(13)).join('');
  return strip(onDisk) === strip(shown.stdout) ? shown.stdout : null;
}

/**
 * What the broker's own children need, and nothing else.
 *
 * `NODE_OPTIONS`, `NODE_PATH`, `GIT_*` and the PowerShell module search path are all absent by
 * omission: an allowlist is the only form of this that stays correct as new variables appear.
 */
const PASSED_ENV: readonly string[] = [
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PROJECTOS_GIT_EXE',
  'PROJECTOS_POWERSHELL_EXE',
];

/**
 * Pin the trusted installation into the source before running it.
 *
 * THE BROKER CANNOT ANCHOR ITSELF. Executed as `node -e`, it has no `__dirname`, and an install root
 * taken from the request would make its checks circular — a caller could name a repository it
 * controls, commit a malicious adapter and a matching allowlist into it, and every check would pass
 * against genuine git. The root is derived here from the running code's own location, which a
 * governed project cannot move.
 */
/**
 * The facts the trusted side must not take from anybody, written into the source it runs.
 *
 * THE SOURCE WAS ALREADY UNSWAPPABLE; THE REQUEST WAS NOT. It travels as a file so that the program
 * can travel as bytes, and nothing bound the bytes read to the bytes written — so a second process
 * running as the same user could rewrite the file between the two, keep every label the binding
 * checks, and replace the question. The resulting decision would then be stamped with the LOCAL
 * request's project, phase and subject, which is exactly the design that stops a model lying about
 * what it answered — and which makes a swapped question indistinguishable from a real one. The digest
 * closes that: the request that runs is the request that was written.
 *
 * AND THE LEDGER'S LOCATION IS NOT A VARIABLE. The broker read `LOCALAPPDATA` out of its own
 * environment to find what it had already spent, and "I cannot find what was spent" answered
 * "nothing" — so one assignment pointed the ceiling and the replay guard at an empty directory. It is
 * pinned here for the same reason the install root is.
 */
function pinned(source: string, installRoot: string, requestSha256: string, stateDir: string): string {
  return [
    `const TRUSTED_INSTALL_ROOT = ${JSON.stringify(installRoot)};`,
    `const TRUSTED_REQUEST_SHA256 = ${JSON.stringify(requestSha256)};`,
    `const TRUSTED_STATE_DIR = ${JSON.stringify(stateDir)};`,
    source,
  ].join('\n');
}

export function nodeBrokeredTransport(sys: System, runtime: ProjectosRuntime): BrokeredTransport {
  return {
    post(call): HttpResponse {
      const source = verifiedBrokerSource(sys, runtime);
      if (source === null) {
        return {
          kind: 'transport-error',
          detail:
            'the trusted gatekeeper transport broker does not match the committed bytes of this ' +
            'installation, so it was not run',
        };
      }

      // The request travels on stdin, never as an argument: command lines are visible to any process
      // listing on the machine.
      const payload = JSON.stringify({
        governedRoot: call.governedRoot,
        projectId: call.projectId,
        phaseId: call.phaseId,
        subjectCommit: call.subjectCommit,
        ask: call.ask,
        requestId: call.requestId,
        credentialRef: call.credentialRef,
        body: call.body,
        timeoutMs: call.timeoutMs ?? 120_000,
      });

      // AN EXPLICIT ENVIRONMENT AND WORKING DIRECTORY.
      //
      // Inheriting them meant the verified bytes ran second: `NODE_OPTIONS=--require ./x.js` preloads
      // a module into the broker before a single verified byte executes, and a relative path there
      // resolves against the inherited cwd — the governed checkout. "What was verified is what runs"
      // is true of the string and was not true of the process. Only what git and PowerShell genuinely
      // need is passed through, and the working directory is the installation.
      const env: NodeJS.ProcessEnv = {};
      for (const name of PASSED_ENV) {
        const value = process.env[name];
        if (typeof value === 'string') env[name] = value;
      }
      // THE TRUSTED SIDE NEEDS A GIT, AND NOTHING WAS GIVING IT ONE.
      //
      // The broker accepts only an absolute, validated `PROJECTOS_GIT_EXE` — it deliberately does not
      // search PATH — and no composition ever set it. So `boundGit()` returned null, every committed
      // read came back empty, and the broker refused every call with "this installation commits no
      // usable credential allowlist" whatever the policy actually said. The whole trusted path was
      // unreachable. The agent already resolves a git it has checked (absolute, non-UNC, correctly
      // named, a real file, and outside the governed checkout); that is the one the child gets.
      if (env['PROJECTOS_GIT_EXE'] === undefined) {
        const bound = resolveBoundGit();
        if (bound !== null) env['PROJECTOS_GIT_EXE'] = bound;
      }

      // THE SOURCE GOES AS BYTES, THE REQUEST GOES AS A FILE.
      //
      // `node -e <source>` put the whole verified program on a command line, and a Windows command
      // line ends at 32,767 characters. The broker crossed that, so the child was killed before
      // running: no stdout, no stderr, status null, and a generic "process failed" for every call. The
      // source now arrives on stdin, still as the exact verified bytes and still never as a path;
      // what is written to disk is the caller's own request, which was untrusted to begin with.
      // WHERE THE INSTALLATION COUNTS WHAT IT SPENDS. Resolved here, on the side that knows, and
      // pinned into the source — never forwarded as a variable the child then trusts.
      const stateDir = nodeInstallationStateDir();
      const scratch = mkdtempSync(join(tmpdir(), 'projectos-broker-'));
      const requestFile = join(scratch, 'request.json');
      let result;
      try {
        writeFileSync(requestFile, payload, 'utf8');
        result = spawnSync(process.execPath, ['-'], {
          input: pinned(source, runtime.installRoot, sha256(payload), stateDir ?? ''),
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
          cwd: runtime.installRoot,
          env: { ...env, PROJECTOS_BROKER_REQUEST: requestFile },
        });
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
      if (result.error !== undefined || result.status !== 0) {
        return {
          kind: 'transport-error',
          detail: (result.stderr ?? '').trim().slice(0, 300) || 'the transport broker process failed',
        };
      }
      try {
        const parsed = JSON.parse(result.stdout ?? '') as { status?: number; body?: string; error?: string };
        if (typeof parsed.error === 'string') return { kind: 'transport-error', detail: parsed.error.slice(0, 300) };
        if (typeof parsed.status !== 'number') {
          return { kind: 'transport-error', detail: 'the transport broker returned no status' };
        }
        return { kind: 'response', status: parsed.status, body: typeof parsed.body === 'string' ? parsed.body : '' };
      } catch {
        return { kind: 'transport-error', detail: 'the transport broker returned unreadable output' };
      }
    },
  };
}
