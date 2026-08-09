/**
 * The renderer's side of the governed command channel.
 *
 * The UI never constructs a command line and never talks to the runtime directly. It calls one of
 * these functions with typed arguments, this module validates the request against the SAME closed
 * vocabulary the sidecar validates against, and the host forwards it verbatim. The reply arrives
 * asynchronously as a `governed-result` on the existing event channel, and the sidecar re-emits the
 * governed state after every command — so what the surface finally shows is re-read durable truth,
 * never an optimistic guess about what the command probably did.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
import type { IpcBridge } from '../daemon/ipcBridge.js';
import {
  validateGovernedCommand,
  GOVERNED_COMMAND_KIND,
  GOVERNED_RESULT_KIND,
  type GovernedCommandArgs,
  type GovernedCommandResult,
  type GovernedVerb,
} from './governedCommands.js';

/** The Tauri command that forwards one governed line. Read-only host transport. */
export const GOVERNED_TAURI_COMMAND = 'daemon_governed_command';

export type GovernedSendOutcome =
  | { readonly ok: true; readonly correlationId: string }
  | { readonly ok: false; readonly lines: readonly string[] };

/** Monotonic, non-secret correlator. Bounded to the pattern the validator accepts. */
let sequence = 0;
export function nextCorrelationId(): string {
  sequence += 1;
  return `cc-${sequence}`;
}

/**
 * Validate and send. Validation happens HERE as well as in the sidecar — not because the sidecar's
 * check is optional, but so a malformed request is reported to the owner immediately instead of
 * making a round trip to be refused.
 */
export async function sendGovernedCommand(
  bridge: IpcBridge,
  verb: GovernedVerb,
  args: GovernedCommandArgs,
  correlationId: string = nextCorrelationId(),
): Promise<GovernedSendOutcome> {
  const request = { kind: GOVERNED_COMMAND_KIND, verb, args, correlationId };
  const check = validateGovernedCommand(request);
  if (!check.ok) {
    return { ok: false, lines: [`REFUSED (${check.code}): ${check.detail}`] };
  }
  if (!bridge.isTauri()) {
    return {
      ok: false,
      lines: [
        'No ProjectOS runtime is connected, so this action was not sent. Governed actions run in the desktop app, where the runtime is available.',
      ],
    };
  }
  try {
    await bridge.invoke(GOVERNED_TAURI_COMMAND, { request: JSON.stringify(request) });
    return { ok: true, correlationId };
  } catch (e) {
    // The host's own refusal text is the owner's next safe action; surface it rather than a generic
    // failure message.
    const detail = typeof e === 'string' ? e : e instanceof Error ? e.message : 'the host refused the command';
    return { ok: false, lines: [`REFUSED (HOST): ${detail}`] };
  }
}

export function isGovernedResult(value: unknown): value is GovernedCommandResult {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    rec['kind'] === GOVERNED_RESULT_KIND &&
    typeof rec['correlationId'] === 'string' &&
    typeof rec['code'] === 'number' &&
    Array.isArray(rec['lines'])
  );
}
