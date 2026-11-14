// Origin: original ProjectOS code
/**
 * THE PORTS OF AN MCP CONNECTOR (PROJECTOS-PORT-MCP1A).
 *
 * Everything the connector needs from outside is one of these ports, and each is injected. There is no spawn here:
 * `SpawnPort` is how a process would be started, and the only implementation in this phase is a fake in the tests.
 * A real one, which would use a child process, is a later phase's work under the owner's gate for service and shell
 * access, and it must meet `SpawnConfinement` below. There is no model port, on purpose: nothing in this module can
 * ask a model for anything, so a server's request can never be answered by one.
 */
import type { McpStartRecord, OwnerQueueItem, ServerManifest } from '@projectos/core';

/**
 * One open connection to one server: lines out and lines in, and a way to end it. The server's side is text, one
 * message a line, and it arrives UNPARSED, because the size cap is judged on what arrived, before anything reads it.
 */
export interface McpTransport {
  send(message: unknown): void | Promise<void>;
  /** Set once. Called for each line the server writes, as text and no larger than `SpawnConfinement.maxLineBytes`. */
  onMessage(handler: (line: string) => void): void;
  close(): Promise<void>;
}

/**
 * WHAT A REAL SPAWN PORT MUST DO. Types and prose only: nothing here starts anything, and a phase that adds a real one
 * must meet each of these, and prove it, before a server runs. The connector hands this to `open` so a port cannot
 * claim it was never told.
 *
 *  - SCRUBBED ENVIRONMENT. The child inherits nothing from its parent. It gets exactly the manifest's `envNames`, with
 *    values from credential custody, and nothing else: not PATH, not a proxy, not a token the parent holds.
 *  - A WORKING DIRECTORY THE PORT OWNS. An empty directory made for this server, never the repository or the owner's
 *    profile, and removed when the connection ends.
 *  - A LINE CAP BEFORE ANY PARSE. A line longer than `maxLineBytes` is dropped, unread, and the stream is not
 *    reassembled from the middle of one. The port reads bytes, and the connector reads what the port hands it.
 *  - STDERR IS BOUNDED. At most `maxStderrBytes` is kept, it is never fed to a model, and it never reaches a prompt.
 *  - RESOURCE LIMITS. A time to live, a memory ceiling, a process count of one (no children) and no inherited handles.
 *  - THE COMMAND IS THE COMMAND. The port launches `manifest.command` with `manifest.args` as an argument vector and no
 *    shell, and refuses to launch a file whose content hash is not the one the owner pinned for it (carried below).
 *
 * CARRIED TO THE PHASE THAT WRITES THE REAL PORT: a binary-content hash pin for the command (the manifest hash covers
 * the path, not the bytes), and an argument schema per row of the owner's allowlist, so a call's arguments are checked
 * against what the owner approved and not against whatever the server's own schema says today.
 */
export interface SpawnConfinement {
  /** No environment is inherited. Only the manifest's variable names are passed, with values from custody. */
  readonly inheritEnvironment: false;
  /** `null`: the port makes and removes an empty directory of its own. */
  readonly workingDirectory: null;
  readonly maxLineBytes: number;
  readonly maxStderrBytes: number;
  readonly limits: {
    readonly timeToLiveMs: number;
    readonly maxMemoryBytes: number;
    readonly maxProcesses: 1;
  };
}

/** Start the server a manifest describes and connect to it. Called only for a manifest the allowlist admitted. */
export interface SpawnPort {
  open(manifest: ServerManifest, confinement: SpawnConfinement): Promise<McpTransport>;
}

/**
 * Put one elicitation in front of the owner and resolve with the owner's raw answer. A rejection, a timeout or an
 * answer that does not parse is treated as a cancel, so a failure here never reads as consent. An implementation
 * must show the item's message as quoted text from a server, and expire what the owner never answers.
 */
export interface OwnerQueuePort {
  enqueue(item: OwnerQueueItem): Promise<unknown>;
}

/**
 * The durable record of a call that is about to be sent. The connector awaits it BEFORE it sends, and sends nothing
 * when it resolves false or throws, so a crash after the send leaves a start the retry rule can see.
 */
export interface StartStorePort {
  record(entry: McpStartRecord): Promise<boolean>;
}

/** A timer, injected, so nothing here owns a clock. `setTimer` returns the function that cancels it. */
export interface TimerPort {
  setTimer(ms: number, fire: () => void): () => void;
}
