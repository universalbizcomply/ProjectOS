// Origin: original ProjectOS code
/**
 * ONE GOVERNED MCP CONNECTION (PROJECTOS-PORT-MCP1A, C15).
 *
 * Opening a connection asks the allowlist first, and a server whose manifest does not hash to its pin is refused
 * before the spawn port is touched. A tool call goes through `admitMcpToolCall`, which asks the connector contract
 * its own questions, and a call is sent to the server only after the gate has admitted it and booked its cost. What
 * comes back is rendered as untrusted data, and the result names the outside content that entered, so the kernel can
 * record it against the run. Run guards are the kernel's to issue and write, and this module does neither.
 *
 * WHAT A SERVER CAN ASK OF THIS CLIENT is decided in core: sampling is refused, an elicitation goes to the owner
 * queue, and anything else is refused. There is no model port in this module, so no request can be answered by one.
 *
 * WHAT IT DOES NOT CARRY. A server's tool descriptions and input schemas are its own words and are dropped: the
 * connection keeps only the names of the tools it was told to expect. The names of the tools to expect come from the
 * owner's row, and a tool the server offers that the row does not list is never exposed.
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
  outputDigestOf,
  parseOwnerAnswer,
  refundCharge,
  renderUntrustedToolOutput,
  SessionClosedError,
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
import type { OwnerQueuePort, McpTransport, SpawnPort } from './ports.js';
import { createRpcClient, ReplyLostError, RpcFailure, type RpcClient, type ServerRequestAnswer } from './rpcClient.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_CLIENT_NAME = 'projectos';
const MAX_TOOL_PAGES = 10;
const MAX_ARGUMENT_CHARS = 65_536;

export interface McpConnectorDeps {
  readonly allowlist: ServerAllowlist;
  /** The manifest as it would be launched. Judged by the allowlist, never trusted as already parsed. */
  readonly manifest: unknown;
  readonly spawn: SpawnPort;
  readonly ownerQueue: OwnerQueuePort;
  /** The clock, for the elicitation window. */
  readonly nowMs: () => number;
  /** What the sessions have already spent, from the durable ledger once there is one. */
  readonly initialTally?: SpendTally;
}

export type OpenCode = ServerAdmissionCode | 'SPAWN_FAILED' | 'INITIALIZE_FAILED';

export type OpenOutcome =
  | { readonly ok: true; readonly connector: McpConnector }
  | { readonly ok: false; readonly code: OpenCode; readonly reasons: readonly string[] };

export interface ToolCallInput {
  readonly tool: string;
  readonly arguments: unknown;
  readonly sessionKey: string;
  readonly registry: ConnectorRegistry;
  readonly actions: ActionRegistry;
  readonly envelope: TaskEnvelope;
  readonly history: unknown;
  readonly facts: ConnectorRetryFacts;
  readonly now: string;
}

export type ToolCallResult =
  | { readonly admitted: false; readonly code: McpToolRefusalCode | 'TOOL_NOT_OFFERED' | 'ARGUMENTS_INVALID'; readonly reasons: readonly string[] }
  | {
      readonly admitted: true;
      readonly outcome: 'succeeded' | 'failed' | 'unknown';
      /** Store this before the call is sent, as the contract requires. It is returned with the result. */
      readonly started: ConnectorStart;
      readonly receipt: ConnectorReceipt | null;
      /** The server's output inside its fence, or `null` when there was none. */
      readonly rendered: string | null;
      /** Where outside content entered, for the kernel to record against the run, or `null` when the server said nothing. */
      readonly outsideContent: string | null;
    };

export interface McpConnector {
  readonly serverKey: string;
  /** The tools the owner listed that the server also offers. Names only. */
  tools(): readonly string[];
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

/** The names a server offers, from every page of its list, kept only where the owner's row names them. */
async function offeredTools(rpc: RpcClient, listed: ReadonlySet<string>): Promise<readonly string[]> {
  const found = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
    const reply = asRecord(await rpc.request('tools/list', cursor === undefined ? undefined : { cursor }));
    const tools = Array.isArray(reply?.['tools']) ? (reply?.['tools'] as readonly unknown[]) : [];
    for (const tool of tools) {
      const name = asRecord(tool)?.['name'];
      if (isToolName(name) && listed.has(name)) found.add(name);
    }
    cursor = typeof reply?.['nextCursor'] === 'string' ? reply['nextCursor'] : undefined;
    if (cursor === undefined) break;
  }
  return [...found].sort();
}

export async function openMcpConnector(deps: McpConnectorDeps): Promise<OpenOutcome> {
  const server = admitServer(deps.allowlist, deps.manifest);
  if (!server.admitted) return { ok: false, code: server.code, reasons: server.reasons };
  const { entry, manifest } = server;
  let transport: McpTransport;
  try {
    transport = await deps.spawn.open(manifest);
  } catch {
    return { ok: false, code: 'SPAWN_FAILED', reasons: ['the server could not be started'] };
  }

  let window: readonly number[] = [];
  const handleServerRequest = async (request: unknown): Promise<ServerRequestAnswer> => {
    const out = decideServerRequest({ serverKey: entry.key, request, window, nowMs: deps.nowMs() });
    window = out.window;
    if (out.decision.kind === 'refused') return { error: out.decision.error };
    // The owner decides. A failure to ask, or an answer that does not parse, is a cancel and never an accept.
    try {
      const answer = parseOwnerAnswer(await deps.ownerQueue.enqueue(out.decision.item), out.decision.item);
      return { result: answer.ok ? answer.answer : { action: 'cancel' } };
    } catch {
      return { result: { action: 'cancel' } };
    }
  };

  const rpc = createRpcClient(transport, handleServerRequest);
  const listed = new Set(Object.keys(entry.tools));
  let offered: readonly string[];
  try {
    const init = asRecord(
      await rpc.request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: MCP_CLIENT_CAPABILITIES, clientInfo: { name: MCP_CLIENT_NAME, version: '0.1.0' } }),
    );
    if (typeof init?.['protocolVersion'] !== 'string') throw new Error('no protocol version');
    await rpc.notify('notifications/initialized');
    offered = await offeredTools(rpc, listed);
  } catch {
    await rpc.close().catch(() => undefined);
    return { ok: false, code: 'INITIALIZE_FAILED', reasons: ['the server did not complete the handshake'] };
  }

  let tally: SpendTally = deps.initialTally ?? EMPTY_TALLY;
  const callTool = async (input: ToolCallInput): Promise<ToolCallResult> => {
    const problem = argumentsProblem(input.arguments);
    if (problem !== null) return { admitted: false, code: 'ARGUMENTS_INVALID', reasons: [problem] };
    if (!offered.includes(input.tool)) return { admitted: false, code: 'TOOL_NOT_OFFERED', reasons: ['the server does not offer this tool, or the owner has not listed it'] };
    const admission = admitMcpToolCall({ ...input, allowlist: deps.allowlist, manifest: deps.manifest, tally });
    if (!admission.admitted) return { admitted: false, code: admission.code, reasons: admission.reasons };
    tally = admission.tally;
    const finish = (outcome: 'succeeded' | 'failed' | 'unknown', errorCode: string | null, rendered: string | null, digest?: string): ToolCallResult => {
      const receipt = mcpReceiptOf(admission, outcome, errorCode, digest);
      return { admitted: true, outcome, started: admission.started, receipt: receipt.ok ? receipt.receipt : null, rendered, outsideContent: rendered === null ? null : `mcp-tool-output:${entry.key}` };
    };
    let reply: unknown;
    try {
      reply = await rpc.request('tools/call', { name: input.tool, arguments: input.arguments });
    } catch (error) {
      // The call never left: give back its cost. The server refused it: the cost stays booked, as a ceiling.
      // Anything else could have run, so the outcome is unknown and the cost stays booked.
      if (error instanceof SessionClosedError && !(error instanceof ReplyLostError)) {
        tally = refundCharge(tally, admission.charge);
        return finish('failed', 'upstream_unavailable', null);
      }
      return error instanceof RpcFailure ? finish('failed', 'upstream_unavailable', null) : finish('unknown', 'outcome_unknown', null);
    }
    const output = untrustedToolOutput(entry.key, input.tool, toToolResult(reply));
    return finish(output.isError ? 'failed' : 'succeeded', output.isError ? 'upstream_unavailable' : null, renderUntrustedToolOutput(output), outputDigestOf(output));
  };

  return { ok: true, connector: { serverKey: entry.key, tools: () => offered, callTool, tally: () => tally, close: () => rpc.close() } };
}
