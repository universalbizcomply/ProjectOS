// Origin: original ProjectOS code
/**
 * THE SERVER ALLOWLIST, PINNED BY HASH (PROJECTOS-PORT-MCP1A, C15).
 *
 * A server runs only if its manifest, whole, hashes to the value the owner approved for it. The manifest is what
 * would be launched: the transport, the command, the arguments and the NAMES of the environment variables passed
 * on. Change any of it, and the hash changes, and the server is refused. There is no install from a catalogue or a
 * URL: a manifest with a `url`, a catalogue name or an install step is refused as malformed, and so is any
 * transport but stdio.
 *
 * THE TABLE OF TOOLS IS THE OWNER'S, NOT THE SERVER'S. Each tool a server may be asked for is listed here with the
 * action it is pinned to and what it costs. A tool the server offers and the row does not list has no action and
 * no budget, so it is never called.
 *
 * EACH TOOL IS PINNED TWICE: by the action it runs under, and by a hash of what it said it was, its description, input
 * schema and annotations, when the owner approved it. A server that describes a tool differently later (a rug pull) no
 * longer hashes to the pin, and the tool is not called.
 *
 * THE LAUNCH IS THE THING APPROVED. A manifest is refused if its command is a package runner (npx, uvx and the like), if
 * an interpreter is asked to run text from the command line, if an argument confirms by itself or names a version that
 * moves, if a name carries a hidden character or a shell operator, if an argument looks like a credential, or if the
 * environment names include one that changes what a program loads (PATH, NODE_OPTIONS, LD_PRELOAD and the like).
 *
 * A REFUSAL SHOWS NONE OF THE MANIFEST. It names the rule and the field, not the value. Pure: the hash is computed
 * in this module, and nothing is read, run or fetched.
 */
import { isActionName } from '../actionRegistry.js';
import { holdsSecretShape } from '../context/redact.js';
import { sha256Hex } from '../execution/evidence.js';
import { isTenantId } from '../tenant.js';
import { isServerId, isToolName, serverKeyOf, type ServerKey } from './serverKeys.js';
import { parseCostPolicy, type CostPolicy } from './toolCosts.js';

export interface ServerManifest {
  readonly serverId: string;
  readonly tenant: string;
  readonly transport: 'stdio';
  readonly command: string;
  readonly args: readonly string[];
  /** Names only. A value comes from credential custody when the server starts, never from a record here. */
  readonly envNames: readonly string[];
}

export type ManifestResult = { readonly ok: true; readonly manifest: ServerManifest } | { readonly ok: false; readonly problems: readonly string[] };

const MANIFEST_FIELDS = ['serverId', 'tenant', 'transport', 'command', 'args', 'envNames'] as const;
const MAX_COMMAND_CHARS = 512;
const MAX_ARGS = 32;
const MAX_ARG_CHARS = 512;
const MAX_ENV_NAMES = 32;
/** A shell operator, a quote or a control character. A path may hold a space, and nothing here is run by a shell. */
const UNSAFE_TEXT = /[;&|<>$`"'*?^%()\u0000-\u001f\u007f]/;
/** What cmd.exe and a shell read as more than text, in an argument. Quotes and a dollar sign are plain in an argument. */
const UNSAFE_ARG = /[&|^%()]/;
/** A control or format character, which is how a name is made to look like another: a right-to-left override, a zero-width space. */
const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
/**
 * Names that change what a program loads or finds, or where it talks, whatever the program is. The value is never in a record,
 * but the name would be enough. Case does not matter.
 */
const DENIED_ENV_NAME = /^(?:PATH|PATHEXT|COMSPEC|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_[A-Z0-9_]*|PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|PERL5OPT|RUBYOPT|BASH_ENV|ENV|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|(?:[A-Z0-9_]*_)?PROXY|SSL_CERT_[A-Z0-9_]*|NPM_CONFIG_[A-Z0-9_]*|GIT_[A-Z0-9_]*)$/i;
/** A command is a path that does not depend on a search path or a working directory: drive, root or UNC share. */
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\/|\\\\[^\\/\s])/;
/** Programs whose job is to fetch and run something else, by name or from the network. */
const PACKAGE_RUNNERS = ['npx', 'npm', 'pnpm', 'pnpx', 'yarn', 'bunx', 'bun', 'uvx', 'uv', 'pipx', 'deno'];
/** Programs whose job is to launch another program: what they start is not what was approved, whatever their arguments. */
const LAUNCHER_WRAPPERS = ['env', 'xargs', 'nohup', 'busybox', 'wsl', 'nice', 'timeout', 'sudo', 'doas', 'start', 'cmd', 'runas', 'stdbuf', 'setsid', 'chroot'];
/** The flags that make each interpreter run text from the command line, or load code, instead of running a file. */
const INLINE_FLAGS: Readonly<Record<string, RegExp>> = Object.freeze({
  'node': /^(?:-[a-z]*[ep][a-z]*|-r|--(?:eval|print|require|import|input-type)(?:=.*)?)$/i,
  nodejs: /^(?:-[a-z]*[ep][a-z]*|-r|--(?:eval|print|require|import|input-type)(?:=.*)?)$/i,
  python: /^-[a-z]*[cm][a-z]*$/i,
  pythonw: /^-[a-z]*[cm][a-z]*$/i,
  py: /^-[a-z]*[cm][a-z]*$/i,
  perl: /^-[a-z]*[er][a-z]*$/i,
  ruby: /^-[a-z]*[er][a-z]*$/i,
  php: /^-[a-z]*[er][a-z]*$/i,
  sh: /^-[a-z]*c[a-z]*$/i,
  bash: /^-[a-z]*c[a-z]*$/i,
  zsh: /^-[a-z]*c[a-z]*$/i,
  dash: /^-[a-z]*c[a-z]*$/i,
  ksh: /^-[a-z]*c[a-z]*$/i,
});
/** PowerShell takes any prefix of -Command or -EncodedCommand, with a dash or a slash. */
const POWERSHELLS = ['powershell', 'pwsh'];
/** An auto-confirm flag, or a version that moves: the thing launched is not the thing that was approved. */
const FLOATING_ARG = /^(?:-y|--yes)$|@(?:latest|next|beta|canary)$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const CONNECTOR_ID = /^[a-z][a-z0-9-]{1,63}$/;
const HASH_DOMAIN = 'projectos-mcp-manifest-v1';

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
}

function textList(value: unknown, max: number, maxChars: number, accepts: (item: string) => boolean): readonly string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const items = value as readonly unknown[];
  return items.every((item) => typeof item === 'string' && item.length <= maxChars && accepts(item)) ? (items as readonly string[]) : null;
}

/** The program's own name, lower case, with its directory, trailing dots and spaces, extension and version suffix off. */
function launcherOf(command: string): string {
  const name = (command.replace(/\\/g, '/').split('/').pop() ?? '').trim().replace(/[. ]+$/, '').toLowerCase().replace(/\.(?:exe|cmd|bat|com|ps1)$/, '').replace(/[. ]+$/, '');
  return name.replace(/[-_]?\d+(?:\.\d+)*$/, '');
}

/** Whether `arg` is -Command or -EncodedCommand, or any abbreviation of either, as PowerShell reads them. */
function powershellInline(arg: string): boolean {
  if (!/^[-/][A-Za-z]+$/.test(arg)) return false;
  const rest = arg.slice(1).toLowerCase();
  return 'command'.startsWith(rest) || 'encodedcommand'.startsWith(rest);
}

/** Why this command and these arguments launch something other than the thing that was approved, or `null`. */
function launchProblem(command: string, args: readonly string[]): string | null {
  if (!ABSOLUTE_PATH.test(command)) return 'the command is not an absolute path, so a search path or a working directory decides what runs';
  const program = launcherOf(command);
  if (PACKAGE_RUNNERS.includes(program)) return 'the command is a package runner, which fetches what it runs';
  if (LAUNCHER_WRAPPERS.includes(program)) return 'the command launches another program, so what runs is not what was approved';
  if (args.some((arg) => FLOATING_ARG.test(arg))) return 'an argument confirms by itself or names a version that moves';
  const inline = Object.hasOwn(INLINE_FLAGS, program) ? INLINE_FLAGS[program] : undefined;
  const interpreter = inline !== undefined || POWERSHELLS.includes(program);
  if (interpreter && args.length === 0) return 'an interpreter must be given a named script';
  if (inline !== undefined && args.some((arg) => inline.test(arg))) return 'an interpreter must run a named script, never text from the command line';
  if (POWERSHELLS.includes(program) && args.some(powershellInline)) return 'an interpreter must run a named script, never text from the command line';
  return null;
}

/** The manifest, or the names of the fields that are wrong. The values are not repeated. */
export function parseManifest(raw: unknown): ManifestResult {
  const record = asRecord(raw);
  if (record === null) return { ok: false, problems: ['the manifest is not an object'] };
  const problems: string[] = [];
  if (Object.keys(record).some((key) => !(MANIFEST_FIELDS as readonly string[]).includes(key))) problems.push('the manifest carries a field that is not part of a manifest');
  if (!isServerId(record['serverId'])) problems.push('serverId is not a server id');
  if (!isTenantId(record['tenant'])) problems.push('tenant is not a tenant id');
  if (record['transport'] !== 'stdio') problems.push('transport must be stdio');
  const command = record['command'];
  if (typeof command !== 'string' || command.trim() === '' || command.length > MAX_COMMAND_CHARS || UNSAFE_TEXT.test(command) || HIDDEN_CHARACTER.test(command) || holdsSecretShape(command)) {
    problems.push('command is empty, too long, holds a shell operator or a hidden character, or looks like a credential');
  }
  const args = textList(record['args'], MAX_ARGS, MAX_ARG_CHARS, (item) => !UNSAFE_ARG.test(item) && !HIDDEN_CHARACTER.test(item) && !holdsSecretShape(item));
  if (args === null) problems.push('args must be a short list of plain text, with no shell operator, hidden character or credential');
  const envNames = textList(record['envNames'], MAX_ENV_NAMES, 64, (item) => ENV_NAME.test(item) && !DENIED_ENV_NAME.test(item));
  if (envNames === null) problems.push('envNames must be a list of variable names, with no value and none that changes what a program loads');
  if (typeof command === 'string' && args !== null) {
    const launch = launchProblem(command, args);
    if (launch !== null) problems.push(launch);
  }
  if (problems.length > 0 || args === null || envNames === null) return { ok: false, problems };
  return {
    ok: true,
    manifest: Object.freeze({
      serverId: record['serverId'] as string,
      tenant: record['tenant'] as string,
      transport: 'stdio' as const,
      command: command as string,
      args: Object.freeze([...args]),
      envNames: Object.freeze([...envNames]),
    }),
  };
}

/** The hash of every field that decides what is launched, in a fixed order, so key order changes nothing. */
export function manifestHashOf(manifest: ServerManifest): string {
  const { serverId, tenant, transport, command, args, envNames } = manifest;
  return `sha256:${sha256Hex(`${HASH_DOMAIN}\n${JSON.stringify([serverId, tenant, transport, command, args, envNames])}`)}`;
}

export interface PinnedTool {
  readonly action: string;
  /** The hash of the tool's description, input schema and annotations. A tool that no longer hashes to it is not called. */
  readonly descriptorHash: string;
}

export interface AllowlistEntry {
  readonly key: ServerKey;
  readonly manifestHash: string;
  readonly connectorId: string;
  /** Tool name to the action it is pinned to and the hash of what it said it was when the owner approved it. */
  readonly tools: Readonly<Record<string, PinnedTool>>;
  readonly costPolicy: CostPolicy;
}

export interface ServerAllowlist {
  readonly servers: readonly AllowlistEntry[];
}

export const EMPTY_ALLOWLIST: ServerAllowlist = Object.freeze({ servers: Object.freeze([]) });

export type AllowlistResult = { readonly ok: true; readonly allowlist: ServerAllowlist } | { readonly ok: false; readonly problems: readonly string[] };

const ROW_FIELDS = ['tenant', 'serverId', 'manifestHash', 'connectorId', 'spendLimit', 'callLimit', 'spendWindowMs', 'tools'] as const;

function rowProblems(row: unknown, index: number): { readonly entry?: AllowlistEntry; readonly problems: readonly string[] } {
  const where = `servers[${index}]`;
  const record = asRecord(row);
  if (record === null) return { problems: [`${where} is not an object`] };
  const problems: string[] = [];
  if (Object.keys(record).some((key) => !(ROW_FIELDS as readonly string[]).includes(key))) problems.push(`${where} carries an unknown field`);
  const tenant = record['tenant'];
  const serverId = record['serverId'];
  const key = typeof tenant === 'string' && typeof serverId === 'string' ? serverKeyOf(tenant, serverId) : null;
  if (key === null) problems.push(`${where} needs a tenant id and a plain server id, with no wildcard`);
  if (typeof record['manifestHash'] !== 'string' || !HASH.test(record['manifestHash'])) problems.push(`${where} manifestHash is not a sha256 pin`);
  if (typeof record['connectorId'] !== 'string' || !CONNECTOR_ID.test(record['connectorId'])) problems.push(`${where} names no connector`);
  const tools = asRecord(record['tools']);
  const pinned: Record<string, PinnedTool> = Object.create(null) as Record<string, PinnedTool>;
  const costs: Record<string, unknown> = {};
  if (tools === null || Object.keys(tools).length === 0) problems.push(`${where} lists no tool`);
  for (const [name, spec] of Object.entries(tools ?? {})) {
    const tool = asRecord(spec);
    const action = tool?.['action'];
    const descriptorHash = tool?.['descriptorHash'];
    if (!isToolName(name) || tool === null || !isActionName(action) || !Object.hasOwn(tool, 'cost') || typeof descriptorHash !== 'string' || !HASH.test(descriptorHash)) {
      problems.push(`${where} lists a tool with no plain name, no action, no cost or no descriptor pin`);
      continue;
    }
    pinned[name] = Object.freeze({ action, descriptorHash });
    costs[name] = tool['cost'];
  }
  const policy = parseCostPolicy(costs, record['spendLimit'], where, { callLimit: record['callLimit'], windowMs: record['spendWindowMs'] });
  if (!policy.ok) problems.push(...policy.problems);
  if (problems.length > 0 || key === null || !policy.ok) return { problems };
  return {
    problems,
    entry: Object.freeze({ key, manifestHash: record['manifestHash'] as string, connectorId: record['connectorId'] as string, tools: Object.freeze(pinned), costPolicy: policy.policy }),
  };
}

/** The owner's allowlist, whole or not at all: one bad row, a duplicate or an unknown field refuses the file. */
export function parseServerAllowlist(raw: unknown): AllowlistResult {
  const record = asRecord(raw);
  const rows = record === null ? null : record['servers'];
  if (!Array.isArray(rows)) return { ok: false, problems: ['the allowlist is not an object with a list of servers'] };
  const read = (rows as readonly unknown[]).map(rowProblems);
  const problems = read.flatMap((result) => result.problems);
  const entries = read.flatMap((result) => (result.entry === undefined ? [] : [result.entry]));
  const keys = entries.map((entry) => entry.key);
  if (new Set(keys).size !== keys.length) problems.push('the allowlist lists one server for one tenant twice');
  return problems.length > 0 ? { ok: false, problems } : { ok: true, allowlist: Object.freeze({ servers: Object.freeze(entries) }) };
}

export type ServerAdmissionCode = 'MANIFEST_INVALID' | 'SERVER_NOT_ALLOWLISTED' | 'MANIFEST_HASH_MISMATCH';

export type ServerAdmission =
  | { readonly admitted: true; readonly entry: AllowlistEntry; readonly manifest: ServerManifest }
  | { readonly admitted: false; readonly code: ServerAdmissionCode; readonly reasons: readonly string[] };

/** THE PIN. The manifest is judged as it was handed in, hashed, and compared with the owner's hash. */
export function admitServer(allowlist: ServerAllowlist, rawManifest: unknown): ServerAdmission {
  const parsed = parseManifest(rawManifest);
  if (!parsed.ok) return { admitted: false, code: 'MANIFEST_INVALID', reasons: parsed.problems };
  const { manifest } = parsed;
  const key = serverKeyOf(manifest.tenant, manifest.serverId);
  const entry = allowlist.servers.find((candidate) => candidate.key === key);
  if (entry === undefined) return { admitted: false, code: 'SERVER_NOT_ALLOWLISTED', reasons: ['no row of the allowlist names this server for this tenant'] };
  if (manifestHashOf(manifest) !== entry.manifestHash) return { admitted: false, code: 'MANIFEST_HASH_MISMATCH', reasons: ['the manifest does not hash to the value the owner approved for this server'] };
  return { admitted: true, entry, manifest };
}
