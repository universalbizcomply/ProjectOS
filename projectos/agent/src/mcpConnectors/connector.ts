// Origin: original ProjectOS code
/**
 * ONE GOVERNED MCP CONNECTION (PROJECTOS-PORT-MCP1A, C15).
 *
 * Opening a connection asks the allowlist first, and a server whose manifest does not hash to its pin is refused
 * before the spawn port is touched. A tool call goes through `admitMcpToolCall`, which asks the connector contract
 * its own questions. Then, in this order and with nothing sent until the last:
 *
 *   - THE LIVE LIST IS READ AGAIN, and the tool's descriptor (its description, input schema and annotations) must still
 *     hash to the value the owner pinned. A server that changes a tool after it was approved, a rug pull, is refused on
 *     the very call, and the connection also stops calling at once on a `tools/list_changed` notice until the list has
 *     been read again and verified. The list that opened the connection is never the evidence for a later call.
 *   - THE START RECORD IS STORED, AND AWAITED. It holds the started line, what was booked and a digest of the
 *     arguments. If the store refuses or throws, nothing is sent and the booking is given back.
 *   - ONLY THEN IS THE CALL SENT, under a timeout. A call that is not answered ends as outcome_unknown, with its cost
 *     still booked.
 *
 * WHAT A SERVER CAN ASK OF THIS CLIENT is decided in core: sampling is refused, an elicitation goes to the owner
 * queue, and anything else is refused. An elicitation is heard only while a call is in flight, at most
 * `MAX_PENDING_ELICITATIONS` are waiting on the owner at once, and a wait the owner never answers ends as a cancel.
 * There is no model port in this module, so no request can be answered by one.
 *
 * WHAT IT DOES NOT CARRY. A server's tool descriptions and input schemas are its own words, and are hashed and dropped:
 * the connection keeps only the names of the tools the owner listed and the server still describes as approved.
 *
 * ONE CALL AT A TIME PER IDEMPOTENCY KEY, AND A FEW AT ONCE. A second call with the key of one in flight is refused, and so
 * is any call past `MAX_CONCURRENT_CALLS`, before anything is booked.
 *
 * ZERO LIVE CONNECTORS. With the committed registry empty, every call is refused by the gate, and nothing here is
 * imported outside this directory and its tests.
 */
import {
  admitServer,
  admitMcpToolCall,
  decideServerRequest,
  isToolName,
  MCP_CLIENT_CAPABILITIES,
  mcpReceiptOf,
  mcpStartRecordOf,
  outputDigestOf,
  parseOwnerAnswer,
  refundCharge,
  renderUntrustedToolOutput,
  SessionClosedError,
  toolDescriptorHashOf,
  toToolResult,
  untrustedToolOutput,
  EMPTY_TALLY,
  type ActionRegistry,
  type ConnectorReceipt,
  type ConnectorRegistry,
  type ConnectorRetryFacts,
  type ConnectorStart,
  type McpToolRefusalCode,
  type ServerAdmissionCode,
  type ServerAllowlist,
  type SpendTally,
  type TaskEnvelope,
} from '@projectos/core';
import type { McpTransport, OwnerQueuePort, SpawnConfinement, SpawnPort, StartStorePort, TimerPort } from './ports.js';
import { createRpcClient, MAX_RPC_MESSAGE_CHARS, ReplyLostError, RpcFailure, type RpcClient, type ServerRequestAnswer } from './rpcClient.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_CLIENT_NAME = 'projectos';
export const MAX_CONCURRENT_CALLS = 4;
export const MAX_PENDING_ELICITATIONS = 2;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_ELICITATION_TIMEOUT_MS = 300_000;
const MAX_TOOL_PAGES = 10;
const MAX_ARGUMENT_CHARS = 65_536;
const TOOLS_CHANGED_NOTICE = 'notifications/tools/list_changed';

/** What the spawn port is told it must do. See `SpawnConfinement`. */
export const SPAWN_CONFINEMENT: SpawnConfinement = Object.freeze({
  inheritEnvironment: false as const,
  workingDirectory: null,
  maxLineBytes: MAX_RPC_MESSAGE_CHARS,
  maxStderrBytes: 65_536,
  limits: Object.freeze({ timeToLiveMs: 3_600_000, maxMemoryBytes: 512 * 1024 * 1024, maxProcesses: 1 as const }),
});

export interface McpConnectorDeps {
  readonly allowlist: ServerAllowlist;
  /** The manifest as it would be launched. Judged by the allowlist, never trusted as already parsed. */
  readonly manifest: unknown;
  readonly spawn: SpawnPort;
  readonly ownerQueue: OwnerQueuePort;
  /** Where a call's start record is stored before the call is sent. */
  readonly startStore: StartStorePort;
  readonly timers: TimerPort;
  /** The clock, for the elicitation window. */
  readonly nowMs: () => number;
  /**
   * The elicitation window of each server, by server key. It is the caller's, and outlives a connection, so closing and
   * opening again is not a new allowance.
   */
  readonly elicitationWindows: Map<string, readonly number[]>;
  readonly requestTimeoutMs?: number;
  readonly elicitationTimeoutMs?: number;
  /** What has already been spent, from the durable ledger once there is one. */
  readonly initialTally?: SpendTally;
}

export type OpenCode = ServerAdmissionCode | 'SPAWN_FAILED' | 'INITIALIZE_FAILED';

export type OpenOutcome =
  | { readonly ok: true; readonly connector: McpConnector }
  | { readonly ok: false; readonly code: OpenCode; readonly reasons: readonly string[] };

export interface ToolCallInput {
  readonly tool: string;
  readonly arguments: unknown;
  readonly registry: ConnectorRegistry;
  readonly actions: ActionRegistry;
  readonly envelope: TaskEnvelope;
  readonly history: unknown;
  readonly facts: ConnectorRetryFacts;
  readonly now: string;
}

export type ToolCallRefusal =
  | McpToolRefusalCode
  | 'TOOL_NOT_OFFERED'
  | 'ARGUMENTS_INVALID'
  | 'CALL_IN_FLIGHT'
  | 'TOO_MANY_IN_FLIGHT'
  | 'TOOLS_STALE'
  | 'TOOL_DESCRIPTOR_CHANGED'
  | 'START_NOT_RECORDED';

export type ToolCallResult =
  | { readonly admitted: false; readonly code: ToolCallRefusal; readonly reasons: readonly string[] }
  | {
      readonly admitted: true;
      readonly outcome: 'succeeded' | 'failed' | 'unknown';
      /** The started line of this call. It was stored through the start store before the call was sent. */
      readonly started: ConnectorStart;
      readonly receipt: ConnectorReceipt | null;
      /** The server's output inside its fence, or `null` when there was none. */
      readonly rendered: string | null;
      /** Where outside content entered, for the kernel to record against the run, or `null` when the server said nothing. */
      readonly outsideContent: string | null;
    };

export type RefreshResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface McpConnector {
  readonly serverKey: string;
  /** The tools the owner listed that the server still describes as approved. Names only. Empty while the list is stale. */
  tools(): readonly string[];
  /** Tools the owner listed that the server now describes differently, so are not called. */
  quarantined(): readonly string[];
  /** Read the list again and verify it. Calls are refused after a list_changed notice until this has succeeded. */
  refresh(): Promise<RefreshResult>;
  callTool(input: ToolCallInput): Promise<ToolCallResult>;
  /** The spend booked so far, for the ledger to store. */
  tally(): SpendTally;
  close(): Promise<void>;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
}

function argumentsProblem(args: unknown): string | null {
  if (asRecord(args) === null) return 'the arguments are not an object';
  try {
    return JSON.stringify(args).length > MAX_ARGUMENT_CHARS ? 'the arguments are larger than a call may carry' : null;
  } catch {
    return 'the arguments cannot be written out';
  }
}

interface ToolsReading {
  readonly offered: readonly string[];
  readonly quarantined: readonly string[];
}

/**
 * Every page of the server's list, judged against the owner's pins. A listed tool is offered only if its descriptor still
 * hashes to the pin; one that does not, or that appears twice with two descriptions, is quarantined; one that is not
 * listed is not offered. Nothing the server wrote is kept, only the hash of it.
 */
async function readTools(rpc: RpcClient, pins: Readonly<Record<string, { readonly descriptorHash: string }>>): Promise<ToolsReading> {
  const seen = new Map<string, string | null>();
  const doubled = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
    const reply = asRecord(await rpc.request('tools/list', cursor === undefined ? undefined : { cursor }));
    const tools = Array.isArray(reply?.['tools']) ? (reply?.['tools'] as readonly unknown[]) : [];
    for (const tool of tools) {
      const name = asRecord(tool)?.['name'];
      if (!isToolName(name) || !Object.hasOwn(pins, name)) continue;
      const hash = toolDescriptorHashOf(tool);
      if (seen.has(name) && seen.get(name) !== hash) doubled.add(name);
      seen.set(name, hash);
    }
    cursor = typeof reply?.['nextCursor'] === 'string' ? reply['nextCursor'] : undefined;
    if (cursor === undefined) break;
  }
  const names = [...seen.keys()].sort();
  const approved = (name: string): boolean => !doubled.has(name) && seen.get(name) === pins[name]?.descriptorHash;
  return { offered: names.filter(approved), quarantined: names.filter((name) => !approved(name)) };
}

/**
 * The promise's value, or `fallback` if it rejects, the timer fires first, or `release` is called (the connection is
 * closing). The timer is cancelled whichever comes first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, timers: TimerPort, fallback: T, releases: Set<() => void>): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const cancel = timers.setTimer(ms, () => end(fallback));
    const release = (): void => end(fallback);
    function end(value: T): void {
      if (settled) return;
      settled = true;
      cancel();
      releases.delete(release);
      resolve(value);
    }
    releases.add(release);
    promise.then(end, () => end(fallback));
  });
}

export async function openMcpConnector(deps: McpConnectorDeps): Promise<OpenOutcome> {
  const server = admitServer(deps.allowlist, deps.manifest);
  if (!server.admitted) return { ok: false, code: server.code, reasons: server.reasons };
  const { entry, manifest } = server;
  let transport: McpTransport;
  try {
    transport = await deps.spawn.open(manifest, SPAWN_CONFINEMENT);
  } catch {
    return { ok: false, code: 'SPAWN_FAILED', reasons: ['the server could not be started'] };
  }

  const inFlight = new Set<string>();
  /** Waits on the owner that a close must end, or the close would wait for an owner who never answers. */
  const ownerWaits = new Set<() => void>();
  let pendingElicitations = 0;
  let stale = false;
  let offered: readonly string[] = [];
  let quarantinedNames: readonly string[] = [];
  const requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const elicitationTimeoutMs = deps.elicitationTimeoutMs ?? DEFAULT_ELICITATION_TIMEOUT_MS;

  const handleServerRequest = async (request: unknown): Promise<ServerRequestAnswer> => {
    const out = decideServerRequest({ serverKey: entry.key, request, window: deps.elicitationWindows.get(entry.key) ?? [], nowMs: deps.nowMs(), callInFlight: inFlight.size > 0 });
    deps.elicitationWindows.set(entry.key, out.window);
    if (out.decision.kind === 'refused') return { error: out.decision.error };
    if (pendingElicitations >= MAX_PENDING_ELICITATIONS) return { error: { code: -32000, message: 'too many requests' } };
    const { item } = out.decision;
    pendingElicitations += 1;
    try {
      // The owner decides. A failure to ask, a wait that is never answered, or an answer that does not parse is a cancel
      // and never an accept.
      const raw = await withTimeout<unknown>(deps.ownerQueue.enqueue(item), elicitationTimeoutMs, deps.timers, { action: 'cancel' }, ownerWaits);
      const answer = parseOwnerAnswer(raw, item);
      return { result: answer.ok ? answer.answer : { action: 'cancel' } };
    } catch {
      return { result: { action: 'cancel' } };
    } finally {
      pendingElicitations -= 1;
    }
  };

  const rpc = createRpcClient(transport, handleServerRequest, {
    timers: deps.timers,
    requestTimeoutMs,
    onNotification: (method) => {
      if (method === TOOLS_CHANGED_NOTICE) stale = true;
    },
  });
  try {
    const init = asRecord(
      await rpc.request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: MCP_CLIENT_CAPABILITIES, clientInfo: { name: MCP_CLIENT_NAME, version: '0.1.0' } }),
    );
    if (typeof init?.['protocolVersion'] !== 'string') throw new Error('no protocol version');
    await rpc.notify('notifications/initialized');
    const reading = await readTools(rpc, entry.tools);
    offered = reading.offered;
    quarantinedNames = reading.quarantined;
  } catch {
    await rpc.close().catch(() => undefined);
    return { ok: false, code: 'INITIALIZE_FAILED', reasons: ['the server did not complete the handshake'] };
  }

  let tally: SpendTally = deps.initialTally ?? EMPTY_TALLY;

  const refresh = async (): Promise<RefreshResult> => {
    try {
      const reading = await readTools(rpc, entry.tools);
      offered = reading.offered;
      quarantinedNames = reading.quarantined;
      stale = false;
      return { ok: true };
    } catch {
      return { ok: false, reason: 'the list could not be read, so calls stay refused' };
    }
  };

  const runCall = async (input: ToolCallInput): Promise<ToolCallResult> => {
    const admission = admitMcpToolCall({ ...input, allowlist: deps.allowlist, manifest: deps.manifest, tally });
    if (!admission.admitted) return { admitted: false, code: admission.code, reasons: admission.reasons };
    tally = admission.tally;
    const giveBack = (): void => {
      tally = refundCharge(tally, admission.charge);
    };
    const finish = (outcome: 'succeeded' | 'failed' | 'unknown', errorCode: string | null, rendered: string | null, digest?: string): ToolCallResult => {
      const receipt = mcpReceiptOf(admission, outcome, errorCode, digest);
      return { admitted: true, outcome, started: admission.started, receipt: receipt.ok ? receipt.receipt : null, rendered, outsideContent: rendered === null ? null : `mcp-tool-output:${entry.key}` };
    };

    // The live list, read now, is the evidence. The list that opened the connection is not.
    try {
      const live = await readTools(rpc, entry.tools);
      offered = live.offered;
      quarantinedNames = live.quarantined;
    } catch (error) {
      giveBack();
      if (error instanceof SessionClosedError) return finish('failed', 'upstream_unavailable', null);
      return { admitted: false, code: 'TOOL_DESCRIPTOR_CHANGED', reasons: ['the server\'s tool list could not be verified, so the call was not sent'] };
    }
    if (!offered.includes(input.tool)) {
      giveBack();
      return { admitted: false, code: 'TOOL_DESCRIPTOR_CHANGED', reasons: ['the server no longer describes this tool as the owner approved it'] };
    }

    // The start record is stored, and awaited, before anything is sent.
    const record = mcpStartRecordOf(admission, input.arguments);
    let stored = false;
    if (record !== null) {
      try {
        stored = await deps.startStore.record(record);
      } catch {
        stored = false;
      }
    }
    if (!stored) {
      giveBack();
      return { admitted: false, code: 'START_NOT_RECORDED', reasons: ['the start of this call could not be stored, so it was not sent'] };
    }

    let reply: unknown;
    try {
      reply = await rpc.request('tools/call', { name: input.tool, arguments: input.arguments });
    } catch (error) {
      // The call never left: give back its cost. The server refused it: the cost stays booked, as a ceiling. Anything else,
      // a timeout or a reply lost to a close, could have run, so the outcome is unknown and the cost stays booked.
      if (error instanceof SessionClosedError && !(error instanceof ReplyLostError)) {
        giveBack();
        return finish('failed', 'upstream_unavailable', null);
      }
      return error instanceof RpcFailure ? finish('failed', 'upstream_unavailable', null) : finish('unknown', 'outcome_unknown', null);
    }
    const output = untrustedToolOutput(entry.key, input.tool, toToolResult(reply));
    return finish(output.isError ? 'failed' : 'succeeded', output.isError ? 'upstream_unavailable' : null, renderUntrustedToolOutput(output), outputDigestOf(output));
  };

  const callTool = async (input: ToolCallInput): Promise<ToolCallResult> => {
    const problem = argumentsProblem(input.arguments);
    if (problem !== null) return { admitted: false, code: 'ARGUMENTS_INVALID', reasons: [problem] };
    const key = input.envelope.idempotencyKey;
    if (inFlight.has(key)) return { admitted: false, code: 'CALL_IN_FLIGHT', reasons: ['a call with this idempotency key is already waiting for its reply'] };
    if (inFlight.size >= MAX_CONCURRENT_CALLS) return { admitted: false, code: 'TOO_MANY_IN_FLIGHT', reasons: ['too many calls are waiting for a reply'] };
    if (stale) return { admitted: false, code: 'TOOLS_STALE', reasons: ['the server said its tools changed, and the list has not been read again'] };
    if (!offered.includes(input.tool)) return { admitted: false, code: 'TOOL_NOT_OFFERED', reasons: ['the server does not offer this tool as the owner approved it, or the owner has not listed it'] };
    inFlight.add(key);
    try {
      return await runCall(input);
    } finally {
      inFlight.delete(key);
    }
  };

  return {
    ok: true,
    connector: { serverKey: entry.key, tools: () => (stale ? [] : offered), quarantined: () => quarantinedNames, refresh, callTool, tally: () => tally, close: () => {
        for (const release of [...ownerWaits]) release();
        return rpc.close();
      },
    },
  };
}
