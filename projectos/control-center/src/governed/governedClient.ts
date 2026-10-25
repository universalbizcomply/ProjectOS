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
import { IPC_EVENT_CHANNEL } from '../daemon/ipcCommands.js';
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

/** What the owner is finally told about a governed command. `ok` is the RUNTIME's verdict. */
export interface GovernedOutcome {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** How long to wait for the runtime's reply before reporting a truthful failure. */
export const GOVERNED_RESULT_TIMEOUT_MS = 30_000;

/**
 * How long to wait for a governed command that calls out to a provider.
 *
 * THIRTY SECONDS IS NOT A PROVIDER'S TIMESCALE. The trusted broker allows a request 120 seconds by
 * default, so the ordinary ceiling above guaranteed the client gave up first — and once it does, it
 * stops listening, so the real answer to a call that cost real money is discarded on arrival. This
 * sits just above the sidecar's own 330-second backstop, so the runtime's honest result always wins
 * over a guess made here.
 */
export const AUTHORING_RESULT_TIMEOUT_MS = 360_000;

/**
 * Send a governed command and report what the RUNTIME actually decided.
 *
 * `sendGovernedCommand` resolves as soon as the request is DISPATCHED, which is not the same thing
 * as the command having worked. The outcome arrives later as a `governed-result` carrying the
 * runtime's own lines. Nothing consumed it, so a refusal — including a G4 closure refusal — left the
 * owner reading "Sent to the runtime" while the action had in fact been refused. That is the exact
 * optimistic-success failure the surface promises not to commit.
 *
 * THE LISTENER IS REGISTERED BEFORE THE COMMAND IS DISPATCHED. A fast runtime can emit its result
 * before a listener attached afterwards would exist, and that result is then gone forever. The
 * ordering here is the fix for that race, not an incidental detail.
 */
export async function requestGovernedCommand(
  bridge: IpcBridge,
  verb: GovernedVerb,
  args: GovernedCommandArgs,
  options: { readonly correlationId?: string; readonly timeoutMs?: number } = {},
): Promise<GovernedOutcome> {
  const correlationId = options.correlationId ?? nextCorrelationId();
  const timeoutMs = options.timeoutMs ?? GOVERNED_RESULT_TIMEOUT_MS;

  const request = { kind: GOVERNED_COMMAND_KIND, verb, args, correlationId };
  const check = validateGovernedCommand(request);
  if (!check.ok) return { ok: false, lines: [`REFUSED (${check.code}): ${check.detail}`] };
  if (!bridge.isTauri()) {
    return {
      ok: false,
      lines: [
        'No ProjectOS runtime is connected, so this action was not sent. Governed actions run in the desktop app, where the runtime is available.',
      ],
    };
  }

  let settle: (outcome: GovernedOutcome) => void = () => {};
  const settled = new Promise<GovernedOutcome>((res) => {
    settle = res;
  });

  // If the result channel cannot be established, the command is NOT sent. Dispatching anyway would
  // ask the runtime to act while we already know we cannot observe or report what it decided — the
  // owner would be left with an action in flight and no verdict, which is worse than not acting.
  let unlisten: () => void;
  try {
    unlisten = await bridge.listen(IPC_EVENT_CHANNEL, (payload) => {
      const result = asGovernedResult(payload);
      // A result for some other command must never resolve this one.
      if (result === null || result.correlationId !== correlationId) return;
      settle({ ok: result.code === 0, lines: result.lines });
    });
  } catch {
    return {
      ok: false,
      lines: [
        'REFUSED (RESULT_CHANNEL): the result channel to the ProjectOS runtime could not be opened, so the action was not sent. Nothing has changed.',
      ],
    };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await bridge.invoke(GOVERNED_TAURI_COMMAND, { request: JSON.stringify(request) });
  } catch (e) {
    unlisten();
    const detail = typeof e === 'string' ? e : e instanceof Error ? e.message : 'the host refused the command';
    return { ok: false, lines: [`REFUSED (HOST): ${detail}`] };
  }

  const timedOut = new Promise<GovernedOutcome>((res) => {
    timer = setTimeout(
      () =>
        res({
          ok: false,
          lines: [
            'The runtime did not report a result before this command timed out. It may or may not have run — the state below is the only reliable answer.',
          ],
        }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    unlisten();
  }
}

/** A `governed-result` payload, however the transport delivered it, or null. */
function asGovernedResult(payload: unknown): GovernedCommandResult | null {
  if (isGovernedResult(payload)) return payload;
  if (typeof payload === 'string') {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (isGovernedResult(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return null;
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
