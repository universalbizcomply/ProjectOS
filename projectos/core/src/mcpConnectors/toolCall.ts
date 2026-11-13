// Origin: original ProjectOS code
/**
 * ONE MCP TOOL CALL, THROUGH EVERY GATE, IN ORDER (PROJECTOS-PORT-MCP1A, C15).
 *
 *   1. THE PIN. The server's manifest, whole, must hash to the owner's value.
 *   2. THE TOOL. The owner's row must name the tool. A tool the server offers and the row does not list is never called.
 *   3. THE ACTION. The envelope's action must be the action the row pins this tool to, so one tool cannot be run under
 *      the authority granted for another.
 *   4. THE CONNECTOR CONTRACT. `admitConnectorCall` asks its own questions: a registered connector, the same tenant and
 *      domain, a declared and registered action, a current acceptance, a retry that is safe. It is not copied here.
 *   5. THE BUDGET. Only a call the contract admitted is booked, so a refused call costs nothing.
 *
 * ZERO LIVE CONNECTORS. The committed registry holds none, so step 4 refuses every call today: there is no
 * connector for `admitConnectorCall` to find. This module is how a connector will run, once there is one.
 *
 * THE START LINE IS THE CALLER'S TO STORE. As the contract says, `started` must be persisted before anything acts,
 * and the booked tally with it, or a crash forgets both. Pure.
 */
import type { ActionRegistry } from '../actionRegistry.js';
import {
  admitConnectorCall,
  checkConnectorReceipt,
  type ConnectorCall,
  type ConnectorGateCode,
  type ConnectorReceiptResult,
  type ConnectorRegistry,
  type ConnectorRetryFacts,
  type ConnectorStart,
} from '../connectorContract.js';
import type { TaskEnvelope } from '../taskEnvelope.js';
import { admitServer, type AllowlistEntry, type ServerAdmissionCode, type ServerAllowlist } from './allowlist.js';
import { splitServerKey } from './serverKeys.js';
import { reserveToolSpend, type Charge, type SpendRefusalCode, type SpendTally } from './toolCosts.js';

export interface McpToolCallRequest {
  readonly allowlist: ServerAllowlist;
  /** The manifest as it would be launched, judged here and never trusted as already parsed. */
  readonly manifest: unknown;
  readonly tool: string;
  readonly sessionKey: string;
  readonly tally: SpendTally;
  readonly registry: ConnectorRegistry;
  readonly actions: ActionRegistry;
  readonly envelope: TaskEnvelope;
  readonly history: unknown;
  readonly facts: ConnectorRetryFacts;
  readonly now: string;
}

export type McpToolRefusalCode = ServerAdmissionCode | 'TOOL_NOT_ALLOWLISTED' | 'TOOL_ACTION_MISMATCH' | ConnectorGateCode | SpendRefusalCode;

export interface AdmittedMcpToolCall {
  readonly admitted: true;
  readonly entry: AllowlistEntry;
  readonly call: ConnectorCall;
  readonly started: ConnectorStart;
  readonly charge: Charge;
  /** The tally with this call booked. Store it with `started`, before the tool runs. */
  readonly tally: SpendTally;
}

export type McpToolAdmission = AdmittedMcpToolCall | { readonly admitted: false; readonly code: McpToolRefusalCode; readonly reasons: readonly string[] };

function refused(code: McpToolRefusalCode, reasons: readonly string[]): McpToolAdmission {
  return { admitted: false, code, reasons };
}

export function admitMcpToolCall(request: McpToolCallRequest): McpToolAdmission {
  const server = admitServer(request.allowlist, request.manifest);
  if (!server.admitted) return refused(server.code, server.reasons);
  const { entry } = server;
  const { tool, envelope } = request;
  const pinnedAction = typeof tool === 'string' && Object.hasOwn(entry.tools, tool) ? entry.tools[tool] : undefined;
  if (pinnedAction === undefined) return refused('TOOL_NOT_ALLOWLISTED', ['the owner\'s row for this server does not name this tool']);
  if (pinnedAction !== envelope.action) return refused('TOOL_ACTION_MISMATCH', ['this tool is pinned to a different action than the envelope carries']);
  const gate = admitConnectorCall({ registry: request.registry, actions: request.actions, connectorId: entry.connectorId, envelope, history: request.history, facts: request.facts, now: request.now });
  if (!gate.admitted) return refused(gate.code, gate.reasons);
  const spend = reserveToolSpend({ policy: entry.costPolicy, serverKey: entry.key, tool, sessionKey: request.sessionKey, tally: request.tally, envelopeBudget: envelope.budget });
  if (!spend.ok) return refused(spend.code, [spend.reason]);
  return { admitted: true, entry, call: gate.call, started: gate.started, charge: spend.charge, tally: spend.tally };
}

/** Sixteen hex characters: a longer unbroken run reads as a credential to the contract's own check. */
const REPLY_DIGEST = /^[0-9a-f]{16}$/;

/**
 * The receipt for an admitted call, judged by the contract's own check. MCP gives no provider receipt, so a
 * success points at a marker that says the server answered, with the digest of its reply. That is the transport's
 * word and the server's, and it is no evidence that the tool did what it said.
 */
export function mcpReceiptOf(admission: AdmittedMcpToolCall, outcome: 'succeeded' | 'failed' | 'unknown', errorCode: string | null, replyDigest?: string): ConnectorReceiptResult {
  const { call, entry } = admission;
  const server = splitServerKey(entry.key);
  const marker = outcome === 'succeeded' && server !== null && replyDigest !== undefined && REPLY_DIGEST.test(replyDigest) ? `provider:mcp-reply:${server.serverId}:${replyDigest}` : null;
  return checkConnectorReceipt(
    {
      tenant: call.envelope.tenant,
      connector: call.connector.connectorId,
      action: call.envelope.action,
      idempotencyKey: call.envelope.idempotencyKey,
      attempt: call.attempt,
      outcome,
      errorCode,
      providerReceipt: marker,
    },
    call,
  );
}
