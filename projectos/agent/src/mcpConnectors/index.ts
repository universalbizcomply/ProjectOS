// Origin: original ProjectOS code
/**
 * The agent side of governed MCP connectors (PROJECTOS-PORT-MCP1A): one connection over injected ports.
 * Unwired: nothing outside this directory and its tests imports it, and no spawn port exists but a fake in the tests.
 */
export {
  DEFAULT_ELICITATION_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_START_STORE_TIMEOUT_MS,
  MAX_CONCURRENT_CALLS,
  MAX_PENDING_ELICITATIONS,
  MCP_CLIENT_NAME,
  MCP_PROTOCOL_VERSION,
  openMcpConnector,
  SPAWN_CONFINEMENT,
  type McpConnector,
  type McpConnectorDeps,
  type OpenCode,
  type OpenOutcome,
  type RefreshResult,
  type ToolCallInput,
  type ToolCallRefusal,
  type ToolCallResult,
} from './connector.js';
export type { McpTransport, OwnerQueuePort, SpawnConfinement, SpawnPort, StartStorePort, TimerPort } from './ports.js';
export {
  createRpcClient,
  MAX_RPC_MESSAGE_CHARS,
  ReplyLostError,
  RequestTimeoutError,
  RpcFailure,
  type RpcClient,
  type RequestControl,
  type RpcClientOptions,
  type ServerRequestAnswer,
  type ServerRequestHandler,
} from './rpcClient.js';
