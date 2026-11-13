// Origin: original ProjectOS code
/**
 * THE PORTS OF AN MCP CONNECTOR (PROJECTOS-PORT-MCP1A).
 *
 * Everything the connector needs from outside is one of these three, and each is injected. There is no spawn here:
 * `SpawnPort` is how a process would be started, and the only implementation in this phase is a fake in the tests.
 * A real one, which would use a child process, is a later phase's work under the owner's gate for service and shell
 * access. There is no model port, on purpose: nothing in this module can ask a model for anything, so a server's
 * request can never be answered by one.
 */
import type { OwnerQueueItem, ServerManifest } from '@projectos/core';

/** One open connection to one server: messages out, messages in, and a way to end it. */
export interface McpTransport {
  send(message: unknown): void | Promise<void>;
  /** Set once. Called for each message the server sends, already parsed. */
  onMessage(handler: (message: unknown) => void): void;
  close(): Promise<void>;
}

/** Start the server a manifest describes and connect to it. Called only for a manifest the allowlist admitted. */
export interface SpawnPort {
  open(manifest: ServerManifest): Promise<McpTransport>;
}

/**
 * Put one elicitation in front of the owner and resolve with the owner's raw answer. A rejection, a timeout or an
 * answer that does not parse is treated as a cancel, so a failure here never reads as consent.
 */
export interface OwnerQueuePort {
  enqueue(item: OwnerQueueItem): Promise<unknown>;
}
