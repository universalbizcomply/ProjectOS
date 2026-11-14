// Origin: original ProjectOS code
/**
 * Governed MCP connectors on the connector contract (PROJECTOS-PORT-MCP1A). The seam of this module: the allowlist
 * pinned by hash, the connection keys, per-tool spend, what a server may ask for, tool output as data, the session
 * lifecycle, and the one gate a tool call passes through.
 *
 * UNWIRED. Nothing outside this directory and its tests imports it. Zero live connectors: the committed registry is
 * empty, so the gate refuses every call until the owner approves a connector and a server.
 */
export {
  admitServer,
  EMPTY_ALLOWLIST,
  manifestHashOf,
  parseManifest,
  parseServerAllowlist,
  type AllowlistEntry,
  type AllowlistResult,
  type ManifestResult,
  type PinnedTool,
  type ServerAdmission,
  type ServerAdmissionCode,
  type ServerAllowlist,
  type ServerManifest,
} from './allowlist.js';
export { argumentsDigestOf, canonicalJsonOf, MAX_CANONICAL_DEPTH, MAX_CANONICAL_NODES, toolDescriptorHashOf } from './canonicalJson.js';
export { MAX_TOOL_BLOCKS, toToolContentBlock, toToolResult, type ToolContentBlock, type ToolResult } from './contentBlocks.js';
export { isServerId, isToolName, resolveServerKey, serverKeyOf, splitServerKey, type ServerKey } from './serverKeys.js';
export {
  decideServerRequest,
  DEFAULT_ELICITATIONS_PER_WINDOW,
  ELICITATION_METHOD,
  ELICITATION_WINDOW_MS,
  MAX_ANSWER_VALUE_CHARS,
  MAX_ELICITATION_FIELDS,
  MAX_ELICITATION_MESSAGE_CHARS,
  MCP_CLIENT_CAPABILITIES,
  parseOwnerAnswer,
  SAMPLING_METHOD,
  type AnswerValue,
  type FieldSpec,
  type OwnerAnswer,
  type OwnerAnswerResult,
  type OwnerQueueItem,
  type RpcError,
  type ServerRequestCode,
  type ServerRequestDecision,
  type ServerRequestInput,
} from './serverRequests.js';
export { createSessionLifecycle, SessionClosedError, type SessionLifecycle } from './sessionLifecycle.js';
export { admitMcpToolCall, mcpReceiptOf, mcpStartRecordOf, type AdmittedMcpToolCall, type McpStartRecord, type McpToolAdmission, type McpToolCallRequest, type McpToolRefusalCode } from './toolCall.js';
export {
  callsOf,
  DEFAULT_CALL_LIMIT,
  DEFAULT_SPEND_WINDOW_MS,
  EMPTY_TALLY,
  parseCostPolicy,
  refundCharge,
  reserveToolSpend,
  spendOf,
  type Charge,
  type CostPolicy,
  type CostPolicyOptions,
  type CostPolicyResult,
  type SpendDecision,
  type SpendRefusalCode,
  type SpendRequest,
  type SpendTally,
  type SpendWindow,
  type ToolCost,
} from './toolCosts.js';
export {
  MAX_TOOL_OUTPUT_CHARS,
  outputDigestOf,
  renderUntrustedToolOutput,
  UNTRUSTED_TOOL_OUTPUT_NOTICE,
  untrustedToolOutput,
  type UntrustedToolOutput,
} from './untrustedOutput.js';
