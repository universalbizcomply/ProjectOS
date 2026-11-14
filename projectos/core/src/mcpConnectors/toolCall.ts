// Origin: original ProjectOS code
/**
 * ONE MCP TOOL CALL, THROUGH EVERY GATE, IN ORDER (PROJECTOS-PORT-MCP1A, C15).
 *
 *   1. THE PIN. The server's manifest, whole, must hash to the owner's value.
 *   2. THE TOOL. The owner's row must name the tool. A tool the server offers and the row does not list is never called.
 *   3. THE ACTION. The envelope's action must be the action the row pins this tool to, so one tool cannot be run under
 *      the authority granted for another.
 *   4. THE TENANT, THREE WAYS. The server's tenant (its key, and its manifest), the connector's tenant and the envelope's
 *      tenant must be one tenant. The contract's gate compares the connector with the envelope; nothing else compares
 *      either with the server, so a row for tenant A that names tenant B's connector would pass it with B's envelope.
 *   5. THE CONNECTOR CONTRACT. `admitConnectorCall` asks its own questions: a registered connector, the same tenant and
 *      domain, a declared and registered action, a current acceptance, a retry that is safe. It is not copied here.
 *   6. THE BUDGET. Only a call the contract admitted is booked, so a refused call costs nothing. The budget is the
 *      server's, in a window, with a call cap: no name the caller chooses starts a fresh one.
 *
 * ZERO LIVE CONNECTORS. The committed registry holds none, so step 5 refuses every call today: there is no
 * connector for `admitConnectorCall` to find. This module is how a connector will run, once there is one.
 *
 * THE START RECORD IS STORED BEFORE THE CALL IS SENT. As the contract says, `started` must be persisted before anything
 * acts, and the booked tally with it, or a crash forgets both and a retry runs the call twice. `mcpStartRecordOf` builds
 * what is stored: the started line, what was booked and a digest of the arguments, which are not stored. The agent hands
 * it to an injected store and awaits it, and sends nothing if the store refuses. Pure.
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
import { argumentsDigestOf } from './canonicalJson.js';
import { splitServerKey } from './serverKeys.js';
import { callsOf, reserveToolSpend, spendOf, type Charge, type SpendRefusalCode, type SpendTally } from './toolCosts.js';

export interface McpToolCallRequest {
  readonly allowlist: ServerAllowlist;
  /** The manifest as it would be launched, judged here and never trusted as already parsed. */
  readonly manifest: unknown;
  readonly tool: string;
  readonly tally: SpendTally;
  readonly registry: ConnectorRegistry;
  readonly actions: ActionRegistry;
  readonly envelope: TaskEnvelope;
  readonly history: unknown;
  readonly facts: ConnectorRetryFacts;
  /** The connector's own clock as an ISO instant, for the contract's expiry and acceptance checks. */
  readonly now: string;
  /**
   * The same instant in milliseconds, from the same clock. Where a spend window starts and ends. The two must be one instant:
   * a time a caller hands in is never used for spend or for staleness, because whoever picks the time picks the window.
   */
  readonly nowMs: number;
}

export type McpToolRefusalCode = ServerAdmissionCode | 'TOOL_NOT_ALLOWLISTED' | 'TOOL_ACTION_MISMATCH' | 'TENANT_MISMATCH' | 'CLOCK_MISMATCH' | ConnectorGateCode | SpendRefusalCode;

export interface AdmittedMcpToolCall {
  readonly admitted: true;
  readonly entry: AllowlistEntry;
  readonly call: ConnectorCall;
  readonly started: ConnectorStart;
  readonly charge: Charge;
  /** The tally with this call booked. Store it with `started`, before the tool is called. */
  readonly tally: SpendTally;
}

export type McpToolAdmission = AdmittedMcpToolCall | { readonly admitted: false; readonly code: McpToolRefusalCode; readonly reasons: readonly string[] };

function refused(code: McpToolRefusalCode, reasons: readonly string[]): McpToolAdmission {
  return { admitted: false, code, reasons };
}

export function admitMcpToolCall(request: McpToolCallRequest): McpToolAdmission {
  if (!Number.isSafeInteger(request.nowMs) || Date.parse(request.now) !== request.nowMs) return refused('CLOCK_MISMATCH', ['the time of the call is not one instant on one clock']);
  const server = admitServer(request.allowlist, request.manifest);
  if (!server.admitted) return refused(server.code, server.reasons);
  const { entry } = server;
  const { tool, envelope } = request;
  const pinned = typeof tool === 'string' && Object.hasOwn(entry.tools, tool) ? entry.tools[tool] : undefined;
  if (pinned === undefined) return refused('TOOL_NOT_ALLOWLISTED', ['the owner\'s row for this server does not name this tool']);
  if (pinned.action !== envelope.action) return refused('TOOL_ACTION_MISMATCH', ['this tool is pinned to a different action than the envelope carries']);
  const tenant = splitServerKey(entry.key)?.tenant;
  if (tenant === undefined || tenant !== server.manifest.tenant || tenant !== envelope.tenant) {
    return refused('TENANT_MISMATCH', ['the server, its manifest and the envelope are not one tenant']);
  }
  const gate = admitConnectorCall({ registry: request.registry, actions: request.actions, connectorId: entry.connectorId, envelope, history: request.history, facts: request.facts, now: request.now });
  if (!gate.admitted) return refused(gate.code, gate.reasons);
  if (gate.call.connector.tenant !== tenant) return refused('TENANT_MISMATCH', ['the connector this row names belongs to another tenant than the server']);
  const spend = reserveToolSpend({ policy: entry.costPolicy, serverKey: entry.key, tool, tally: request.tally, envelopeBudget: envelope.budget, nowMs: request.nowMs });
  if (!spend.ok) return refused(spend.code, [spend.reason]);
  return { admitted: true, entry, call: gate.call, started: gate.started, charge: spend.charge, tally: spend.tally };
}

/** What is stored before a call is sent. It holds a digest of the arguments and none of the arguments. */
export interface McpStartRecord {
  readonly started: ConnectorStart;
  readonly serverKey: string;
  readonly tool: string;
  readonly argumentsDigest: string;
  /** The micro-USD this call booked, at the top of its range. */
  readonly bookedMicroUsd: number;
  /** The window's spend and call count with this call in them. */
  readonly spentAfter: number;
  readonly callsAfter: number;
}

/** The record to store for an admitted call, or `null` when the arguments cannot be read and so cannot be digested. */
export function mcpStartRecordOf(admission: AdmittedMcpToolCall, args: unknown): McpStartRecord | null {
  const argumentsDigest = argumentsDigestOf(args);
  if (argumentsDigest === null) return null;
  const { started, charge, tally } = admission;
  return Object.freeze({
    started,
    serverKey: charge.serverKey,
    tool: charge.tool,
    argumentsDigest,
    bookedMicroUsd: charge.cost.high,
    spentAfter: spendOf(tally, charge.serverKey),
    callsAfter: callsOf(tally, charge.serverKey),
  });
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
