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

/** Where the trusted broker lives, relative to the installation root. */
export const TRANSPORT_BROKER_REL = 'projectos/security/gatekeeper-transport-broker.cjs';

export interface BrokeredCall {
  readonly governedRoot: string;
  readonly projectId: string;
  readonly phaseId: string;
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
        installRoot: runtime.installRoot,
        governedRoot: call.governedRoot,
        projectId: call.projectId,
        phaseId: call.phaseId,
        credentialRef: call.credentialRef,
        body: call.body,
        timeoutMs: call.timeoutMs ?? 120_000,
      });

      const result = spawnSync(process.execPath, ['-e', source], {
        input: payload,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      });
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
