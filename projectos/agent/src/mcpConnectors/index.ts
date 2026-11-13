// Origin: original ProjectOS code
/**
 * The agent side of governed MCP connectors (PROJECTOS-PORT-MCP1A): one connection over injected ports.
 * Unwired: nothing outside this directory and its tests imports it, and no spawn port exists but a fake in the tests.
 */
export {
  MCP_CLIENT_NAME,
  MCP_PROTOCOL_VERSION,
  openMcpConnector,
  type McpConnector,
  type McpConnectorDeps,
  type OpenCode,
  type OpenOutcome,
  type ToolCallInput,
  type ToolCallResult,
} from './connector.js';
export type { McpTransport, OwnerQueuePort, SpawnPort } from './ports.js';
export { createRpcClient, MAX_RPC_MESSAGE_CHARS, ReplyLostError, RpcFailure, type RpcClient, type ServerRequestAnswer, type ServerRequestHandler } from './rpcClient.js';
