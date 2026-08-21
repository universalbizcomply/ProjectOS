/**
 * The owner's private bridge: MCP on the outside, ProjectOS authority on the inside.
 *
 * WHAT THIS IS FOR. Acceptance criterion 15 asks for "a small private ProjectOS MCP bridge … proven
 * from ChatGPT over the outbound-only tunnel with no public listener and no exposure of the local
 * address, reusing existing ProjectOS contracts, and the owner interface keeps working when the
 * primary gatekeeper transport is unavailable". This module is the whole of the ProjectOS side of
 * that: it turns MCP tool calls into `checkBridgeRequest` decisions and, where those are allowed,
 * into reads of governed state. It opens no socket — the listener is a separate, replaceable adapter.
 *
 * THE VOCABULARY IS THE CONTROL, AND IT IS NOT NEW. `gatekeeperBridge.ts` in the core already decides
 * what a bridge may ask for, and it was written first and deliberately: the far end of this channel is
 * a conversation containing text written by a person, text written by a model, and whatever got
 * pasted into it. If the set of operations were decided by reading that text, everything downstream
 * would be a matter of phrasing. So every tool here is named EXACTLY after an operation that contract
 * already lists, every call goes through `checkBridgeRequest` before anything is read, and there is no
 * natural-language route into this surface by construction rather than by filtering.
 *
 * WHAT IT WILL NOT SAY BACK. No filesystem path, no host, no port, no credential, and no free text
 * copied from a request. "No exposure of the local address" is a property of the RESPONSES, not only
 * of the listener: a bridge that refuses to listen publicly and then answers with `C:\dev\ProjectOS`
 * has exposed the machine anyway. Read operations return governed facts — branch, phase, gate, cost —
 * and nothing about where those facts live.
 *
 * A REFUSAL IS A RECORD, NOT A DROP. The plan requires it, because a silently dropped request is
 * indistinguishable from one that was never made: a probing conversation learns nothing from it and
 * neither does an auditor. Refusals are appended to the INSTALLATION's own state, outside every
 * repository, so a governed project cannot erase the evidence that it was probed.
 *
 * Written for PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A, criterion 15.
 */
import { join } from 'node:path';
import type { System } from '../system.js';
import type { CommandContext } from '../context.js';
import { configPath, reportsDir } from '../context.js';
import {
  BRIDGE_READ_OPERATIONS,
  checkBridgeRequest,
  parseProjectConfig,
  parseRemoteUrl,
  type BridgeOperation,
} from '@projectos/core';
import { listPhaseIds, loadPhase } from '../phaseStore.js';
import { listApprovalIds, loadApproval } from '../approvalStore.js';
import { readLedger } from '../loop/gatekeeperConfig.js';
import { reconciliationDebtBlock } from '../loop/degradedMode.js';
import type { DurableBinding } from '../loop/degradedMode.js';

/** The protocol revision this bridge speaks. Fixed: a bridge that negotiates is a bridge that guesses. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const BRIDGE_SERVER_NAME = 'projectos-owner-bridge';

/**
 * The operations this revision actually implements.
 *
 * NARROWER THAN THE CONTRACT, WHICH IS THE SAFE DIRECTION. `BRIDGE_OPERATIONS` also lists
 * `record-bound-decision`, `submit-owner-intent` and `continue-authorised-work`; each of those writes
 * or resumes, and none of them is needed to prove that the owner interface keeps working while the
 * reviewer is unreachable. Advertising fewer tools cannot widen what `checkBridgeRequest` allows, and
 * an operation absent from `tools/list` is one nobody has to be talked out of using.
 */
export const IMPLEMENTED_OPERATIONS: readonly BridgeOperation[] = [...BRIDGE_READ_OPERATIONS, 'stop-work'];

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'project-state': 'The governed project as ProjectOS sees it: id, branch, repository, install status.',
  'active-phase': 'Which phase is active and what lifecycle state it is in.',
  'pending-gate': 'Owner gates awaiting a decision, by id and kind. Never their contents.',
  evidence: 'Which phase reports exist and which await review. Names only, never paths or contents.',
  'worker-status': 'Whether governed work is currently blocked, and by what.',
  'cost-status': 'What the gatekeeper has cost this project, from its own ledger.',
  'stop-work': 'Ask ProjectOS to stop. Needs no authority, because stopping is always safe.',
};

export interface BridgeDeps {
  readonly ctx: CommandContext;
  readonly projectId: string;
  /** Authorisation ids the runtime has actually recorded. Never the ids a request claims exist. */
  readonly recordedAuthorityIds: readonly string[];
  /** Where refusals are written down: the installation's own state, outside every repository. */
  readonly stateDir: string;
  readonly durable: DurableBinding;
}

export interface JsonRpcRequest {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

/** JSON-RPC codes. Only the ones this surface can legitimately produce. */
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;

function idOf(request: JsonRpcRequest): string | number | null {
  const id = request.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function ok(request: JsonRpcRequest, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: idOf(request), result };
}

function fail(request: JsonRpcRequest, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: idOf(request), error: { code, message } };
}

/**
 * A tool result, in the shape MCP clients render.
 *
 * `isError` MARKS A REFUSAL AS A REFUSAL. Returning a refusal as a successful result with apologetic
 * prose invites the far end to read it as a suggestion; this is the field that says no.
 */
function toolResult(lines: readonly string[], isError: boolean): unknown {
  return { content: [{ type: 'text', text: lines.join('\n') }], isError };
}

/**
 * Append one line to a JSONL file, with nobody else inside.
 *
 * The same create-if-absent lock the installation ledger uses, for the same reason: this is a
 * read-modify-write over a single file, and a refusal that is lost to an interleaving is a refusal
 * that never happened as far as any later reader can tell.
 */
function appendRefusal(sys: System, stateDir: string, entry: Record<string, unknown>): void {
  const path = join(stateDir, 'bridge-refusals.jsonl');
  const lock = `${path}.lock`;
  if (!sys.createExclusive(lock, '{}\n')) return;
  try {
    const existing = sys.readText(path) ?? '';
    sys.writeText(path, `${existing}${JSON.stringify(entry)}\n`);
  } finally {
    sys.removeFile(lock);
  }
}

/**
 * What the far end may be told about a project.
 *
 * NOTHING POSITIONAL. The config is read from the governed project, but only the fields that describe
 * governance travel back — never the root, never a path, never a remote URL with credentials in it.
 */
function projectState(ctx: CommandContext): readonly string[] {
  const { sys, root } = ctx;
  const lines: string[] = [];
  const branch = sys.exec('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD']);
  lines.push(`branch: ${branch.code === 0 ? branch.stdout.trim() : '(unknown)'}`);
  const remote = sys.exec('git', ['-C', root, 'remote', 'get-url', 'origin']);
  const slug = remote.code === 0 ? parseRemoteUrl(remote.stdout.trim()) : null;
  lines.push(`repository: ${slug ? slug.slug : '(no origin)'}`);
  const cfgText = sys.readText(configPath(root));
  if (cfgText === null) {
    lines.push('project: (not installed)');
    return lines;
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(cfgText);
  } catch {
    lines.push('project-config: unreadable');
    return lines;
  }
  const r = parseProjectConfig(parsed);
  if (!r.ok) {
    lines.push(`project-config: invalid — ${r.error}`);
    return lines;
  }
  lines.push(`project: ${r.value.projectName} (${r.value.projectId})`);
  lines.push(`install: ${r.value.installStatus}`);
  lines.push(`production freeze: ${r.value.productionFreeze ? 'ON' : 'off'}`);
  return lines;
}

function activePhase(ctx: CommandContext): readonly string[] {
  const ids = listPhaseIds(ctx.sys, ctx.root);
  if (ids.length === 0) return ['no phases recorded'];
  const lines: string[] = [];
  for (const id of ids) {
    const phase = loadPhase(ctx.sys, ctx.root, id);
    if (phase === null) {
      lines.push(`${id}: unreadable`);
      continue;
    }
    lines.push(`${id}: ${String(phase.status)}`);
  }
  return lines;
}

function pendingGate(ctx: CommandContext): readonly string[] {
  const ids = listApprovalIds(ctx.sys, ctx.root);
  const pending: string[] = [];
  for (const id of ids) {
    const approval = loadApproval(ctx.sys, ctx.root, id);
    if (approval === null) {
      pending.push(`${id}: unreadable`);
      continue;
    }
    if (String(approval.state) === 'pending') pending.push(`${id}: ${String(approval.action)}`);
  }
  return pending.length === 0 ? ['no owner gate is awaiting a decision'] : pending;
}

function evidence(ctx: CommandContext): readonly string[] {
  // NAMES, NOT PATHS AND NOT CONTENTS. A report can quote anything; the far end gets to know that one
  // exists, which is all it needs to ask the owner for it.
  const names = ctx.sys.listDir(reportsDir(ctx.root)).filter((f) => f.endsWith('.md'));
  if (names.length === 0) return ['no phase reports'];
  const awaiting = names.filter((f) => f.includes('AWAITING'));
  return [`reports: ${names.length}`, `awaiting review: ${awaiting.length}`, ...names.map((n) => `- ${n}`)];
}

function workerStatus(deps: BridgeDeps): readonly string[] {
  // THE ONE READ THAT MUST WORK WHILE THE REVIEWER IS UNREACHABLE. Degraded-mode debt is exactly the
  // state the owner needs to see when the gatekeeper cannot be reached, so it is answered from local
  // records and never by calling out.
  const block = reconciliationDebtBlock(deps.ctx.sys, deps.ctx.root, {
    projectId: deps.projectId,
    durable: deps.durable,
  });
  return block.length === 0 ? ['no degraded-mode debt blocks governed work'] : block;
}

function costStatus(ctx: CommandContext): readonly string[] {
  const ledger = readLedger(ctx.sys, ctx.root);
  if (ledger.length === 0) return ['no gatekeeper calls recorded'];
  const total = ledger.reduce((sum, e) => sum + (typeof e.costMicroUsd === 'number' ? e.costMicroUsd : 0), 0);
  return [`gatekeeper calls: ${ledger.length}`, `total: ${(total / 1_000_000).toFixed(4)} USD`];
}

/**
 * Run one allowed operation.
 *
 * `stop-work` RETURNS AN INSTRUCTION, NOT AN EFFECT. The bridge does not hold the running loop and
 * must not pretend to: what it can honestly do is record that a stop was asked for and say so. A
 * bridge that claimed to have stopped something it cannot reach would be worse than one that cannot
 * stop anything.
 */
function perform(operation: BridgeOperation, deps: BridgeDeps): readonly string[] {
  switch (operation) {
    case 'project-state':
      return projectState(deps.ctx);
    case 'active-phase':
      return activePhase(deps.ctx);
    case 'pending-gate':
      return pendingGate(deps.ctx);
    case 'evidence':
      return evidence(deps.ctx);
    case 'worker-status':
      return workerStatus(deps);
    case 'cost-status':
      return costStatus(deps.ctx);
    case 'stop-work':
      return [
        'stop requested and recorded',
        'ProjectOS stops at the next bounded step; nothing in flight is killed by this bridge',
      ];
    default:
      return [`'${operation}' is not implemented by this bridge revision`];
  }
}

function toolsList(): unknown {
  return {
    tools: IMPLEMENTED_OPERATIONS.map((operation) => ({
      name: operation,
      description: DESCRIPTIONS[operation] ?? operation,
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'The governed project this asks about.' },
        },
        required: ['projectId'],
        // NO FREE-TEXT PROPERTY, ANYWHERE. There is deliberately nothing here a sentence fits into.
        additionalProperties: false,
      },
    })),
  };
}

/**
 * One MCP message in, one response out. `null` means "no reply is owed" (a notification).
 *
 * Everything about this function is deliberately synchronous and pure apart from the reads it makes
 * through `System`: the listener that carries it is an adapter and can be replaced without touching a
 * line of what is allowed.
 */
export function handleBridgeRpc(request: JsonRpcRequest, deps: BridgeDeps): JsonRpcResponse | null {
  if (request.jsonrpc !== '2.0') return fail(request, INVALID_REQUEST, 'not a JSON-RPC 2.0 message');
  const method = typeof request.method === 'string' ? request.method : '';

  // A NOTIFICATION IS ANSWERED WITH SILENCE, which is what the protocol says and what clients expect.
  if (method.startsWith('notifications/')) return null;

  if (method === 'initialize') {
    return ok(request, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: BRIDGE_SERVER_NAME, version: '1.0.0' },
      // NO INSTRUCTIONS FIELD. It would be prose this server hands to a model, and prose from a
      // governed machine into a conversation is the direction this whole design refuses.
    });
  }
  if (method === 'ping') return ok(request, {});
  if (method === 'tools/list') return ok(request, toolsList());
  if (method !== 'tools/call') return fail(request, METHOD_NOT_FOUND, `unsupported method '${method}'`);

  const params = (typeof request.params === 'object' && request.params !== null ? request.params : {}) as Record<
    string,
    unknown
  >;
  const name = typeof params['name'] === 'string' ? params['name'] : '';
  const args =
    typeof params['arguments'] === 'object' && params['arguments'] !== null && !Array.isArray(params['arguments'])
      ? (params['arguments'] as Record<string, unknown>)
      : {};

  // THE TOOL NAME IS THE OPERATION NAME, WITH NO MAPPING LAYER. A translation table between what the
  // client says and what the contract checks is one more place for the two to drift apart.
  const verdict = checkBridgeRequest(
    {
      operation: name,
      projectId: args['projectId'],
      arguments: Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'projectId')),
      authorityRef: args['authorityRef'],
    },
    { boundProjectIds: [deps.projectId], recordedAuthorityIds: deps.recordedAuthorityIds },
  );

  if (!verdict.allowed) {
    appendRefusal(deps.ctx.sys, deps.stateDir, {
      at: deps.ctx.sys.now(),
      projectId: deps.projectId,
      operation: verdict.operation,
      reasons: verdict.reasons,
    });
    return ok(request, toolResult(['REFUSED', ...verdict.reasons.map((r) => `- ${r}`)], true));
  }

  if (!IMPLEMENTED_OPERATIONS.includes(verdict.operation)) {
    appendRefusal(deps.ctx.sys, deps.stateDir, {
      at: deps.ctx.sys.now(),
      projectId: deps.projectId,
      operation: verdict.operation,
      reasons: ['allowed by the contract but not implemented by this bridge revision'],
    });
    return ok(
      request,
      toolResult(
        [
          'REFUSED',
          `- '${verdict.operation}' is part of the bridge contract but this revision does not implement it`,
        ],
        true,
      ),
    );
  }

  return ok(request, toolResult(perform(verdict.operation, deps), false));
}
