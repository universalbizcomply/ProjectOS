/**
 * The server allowlist, pinned by hash, and the connection keys (PROJECTOS-PORT-MCP1A).
 * Each refusal stands next to a positive control, so a default cannot pass for the rule.
 */
import { describe, expect, it } from 'vitest';
import {
  admitServer,
  EMPTY_ALLOWLIST,
  manifestHashOf,
  parseManifest,
  parseServerAllowlist,
  resolveServerKey,
  serverKeyOf,
  splitServerKey,
  type ServerAllowlist,
  type ServerManifest,
} from '../src/mcpConnectors/index.js';

const MANIFEST = {
  serverId: 'mail-reader',
  tenant: 'agency-business',
  transport: 'stdio',
  command: 'C:/tools/mcp/mail-reader.exe',
  args: ['--readonly'],
  envNames: ['MAIL_TOKEN_REF'],
};

function manifestOf(over: Record<string, unknown> = {}): ServerManifest {
  const parsed = parseManifest({ ...MANIFEST, ...over });
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return parsed.manifest;
}

const DESCRIPTOR = `sha256:${'d'.repeat(64)}`;

const serverRow = (over: Record<string, unknown> = {}) => ({
  tenant: 'agency-business',
  serverId: 'mail-reader',
  manifestHash: manifestHashOf(manifestOf()),
  connectorId: 'fixture-mail',
  spendLimit: 5_000,
  tools: { search_mail: { action: 'bridge-read', cost: 100, descriptorHash: DESCRIPTOR } },
  ...over,
});

function allowlistOf(rows: readonly unknown[] = [serverRow()]): ServerAllowlist {
  const parsed = parseServerAllowlist({ servers: rows });
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return parsed.allowlist;
}

describe('the manifest', () => {
  it('a complete stdio manifest is read: the positive control', () => {
    expect(parseManifest(MANIFEST)).toMatchObject({ ok: true });
  });

  it.each([
    ['a url, which would be a network install', { url: 'https://example.invalid/server' }],
    ['a catalogue name, which would be an install by name', { catalogue: 'optional-mcps/mail' }],
    ['an install step', { install: 'npx some-server' }],
    ['a transport that is not stdio', { transport: 'http' }],
    ['an empty command', { command: '' }],
    ['a command with a shell operator', { command: 'node server.js && curl evil' }],
    ['an argument with a NUL', { args: ['a\0b'] }],
    ['an argument that is not text', { args: [1] }],
    ['an environment name that carries a value', { envNames: ['TOKEN=abc'] }],
    ['an unknown server id', { serverId: 'Mail Reader' }],
    ['an unknown tenant shape', { tenant: 'Agency' }],
  ])('refuses %s', (_label, over) => {
    expect(parseManifest({ ...MANIFEST, ...over })).toMatchObject({ ok: false });
  });

  it('is hashed from its fields, so key order changes nothing and any field changes the hash', () => {
    const reordered = parseManifest({ envNames: MANIFEST.envNames, args: MANIFEST.args, command: MANIFEST.command, transport: 'stdio', tenant: MANIFEST.tenant, serverId: MANIFEST.serverId });
    expect(reordered.ok && manifestHashOf(reordered.manifest)).toBe(manifestHashOf(manifestOf()));
    expect(manifestHashOf(manifestOf({ command: 'C:/tools/mcp/other.exe' }))).not.toBe(manifestHashOf(manifestOf()));
    expect(manifestHashOf(manifestOf({ args: ['--readonly', '--write'] }))).not.toBe(manifestHashOf(manifestOf()));
    expect(manifestHashOf(manifestOf({ envNames: [] }))).not.toBe(manifestHashOf(manifestOf()));
    expect(manifestHashOf(manifestOf())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('manifest hygiene (M3)', () => {
  const FAKE_KEY = ['sk', 'ant', 'api03', 'abcdefghij', 'klmnopqrst', 'uvwxyz0123'].join('-');

  it.each([
    ['PATH', ['PATH']],
    ['PATHEXT', ['PATHEXT']],
    ['COMSPEC', ['COMSPEC']],
    ['NODE_OPTIONS', ['NODE_OPTIONS']],
    ['LD_PRELOAD', ['LD_PRELOAD']],
    ['LD_LIBRARY_PATH', ['LD_LIBRARY_PATH']],
    ['DYLD_INSERT_LIBRARIES', ['DYLD_INSERT_LIBRARIES']],
    ['PYTHONPATH', ['PYTHONPATH']],
    ['PYTHONHOME', ['PYTHONHOME']],
  ])('refuses the environment name %s, which changes what a program loads', (_name, envNames) => {
    expect(parseManifest({ ...MANIFEST, envNames })).toMatchObject({ ok: false });
  });

  it.each([
    ['a caret in the command', { command: 'C:/tools/a^b.exe' }],
    ['a percent sign in the command', { command: 'C:/tools/%TEMP%/a.exe' }],
    ['an ampersand in an argument', { args: ['a&b'] }],
    ['a pipe in an argument', { args: ['a|b'] }],
    ['a parenthesis in an argument', { args: ['(a)'] }],
    ['a caret in an argument', { args: ['a^b'] }],
    ['a right-to-left override in an argument', { args: ['--name=‮gpj.exe'] }],
    ['a zero-width space in the command', { command: 'C:/tools/mcp/mail​-reader.exe' }],
    ['a control character above 0x7f in an argument', { args: ['ab'] }],
    ['a credential in an argument', { args: [`--key=${FAKE_KEY}`] }],
  ])('refuses %s', (_label, over) => {
    expect(parseManifest({ ...MANIFEST, ...over })).toMatchObject({ ok: false });
  });

  it.each([
    ['npx', { command: 'npx', args: ['some-mcp-server'] }],
    ['an npx path with an extension', { command: 'C:/Program Files/nodejs/npx.cmd', args: ['x'] }],
    ['uvx', { command: 'uvx', args: ['some-server'] }],
    ['pnpm dlx style runners', { command: 'pnpm', args: ['dlx', 'x'] }],
    ['bunx', { command: 'bunx', args: ['x'] }],
    ['an auto-yes flag', { command: 'C:/tools/mcp/mail-reader.exe', args: ['-y'] }],
    ['a --yes flag', { command: 'C:/tools/mcp/mail-reader.exe', args: ['--yes'] }],
    ['a floating version', { command: 'C:/tools/mcp/mail-reader.exe', args: ['server@latest'] }],
    ['node -e', { command: 'node', args: ['-e', 'run()'] }],
    ['node --eval', { command: 'C:/Program Files/nodejs/node.exe', args: ['--eval', 'run()'] }],
    ['python -c', { command: 'python3', args: ['-c', 'import x'] }],
    ['powershell -Command', { command: 'powershell.exe', args: ['-Command', 'x'] }],
    ['cmd /c', { command: 'cmd', args: ['/c', 'x'] }],
    ['sh -c', { command: '/bin/sh', args: ['-c', 'x'] }],
  ])('refuses a launch that is a package runner or an inline program: %s', (_label, over) => {
    expect(parseManifest({ ...MANIFEST, ...over })).toMatchObject({ ok: false });
  });

  it('allows an interpreter that runs a named script, and a plain pinned binary: the positive control', () => {
    expect(parseManifest({ ...MANIFEST, command: 'node', args: ['C:/tools/mcp/server.js'] })).toMatchObject({ ok: true });
    expect(parseManifest(MANIFEST)).toMatchObject({ ok: true });
  });

  it('an environment name that is not on the list, still passes', () => {
    expect(parseManifest({ ...MANIFEST, envNames: ['MAIL_TOKEN_REF', 'LOG_LEVEL'] })).toMatchObject({ ok: true });
  });
});

describe('the allowlist pin', () => {
  it('admits the pinned manifest: the positive control', () => {
    expect(admitServer(allowlistOf(), MANIFEST)).toMatchObject({ admitted: true });
  });

  it('refuses a server whose manifest hash differs from its pin', () => {
    const swapped = { ...MANIFEST, command: 'C:/tools/mcp/swapped.exe' };
    expect(admitServer(allowlistOf(), swapped)).toMatchObject({ admitted: false, code: 'MANIFEST_HASH_MISMATCH' });
  });

  it('refuses an added argument, because the hash covers the arguments', () => {
    expect(admitServer(allowlistOf(), { ...MANIFEST, args: ['--readonly', '--write'] })).toMatchObject({ admitted: false, code: 'MANIFEST_HASH_MISMATCH' });
  });

  it('refuses a server nobody listed, and a listed server for another tenant', () => {
    expect(admitServer(allowlistOf(), { ...MANIFEST, serverId: 'other-server' })).toMatchObject({ admitted: false, code: 'SERVER_NOT_ALLOWLISTED' });
    expect(admitServer(allowlistOf(), { ...MANIFEST, tenant: 'owner-personal' })).toMatchObject({ admitted: false, code: 'SERVER_NOT_ALLOWLISTED' });
  });

  it('refuses everything while the allowlist is empty', () => {
    expect(admitServer(EMPTY_ALLOWLIST, MANIFEST)).toMatchObject({ admitted: false, code: 'SERVER_NOT_ALLOWLISTED' });
  });

  it('refuses a manifest that is not well formed, before it is hashed', () => {
    expect(admitServer(allowlistOf(), { ...MANIFEST, url: 'https://example.invalid' })).toMatchObject({ admitted: false, code: 'MANIFEST_INVALID' });
  });

  it('a refusal repeats none of the manifest text', () => {
    const refusal = admitServer(allowlistOf(), { ...MANIFEST, command: 'C:/tools/mcp/swapped-secret-name.exe' });
    expect(JSON.stringify(refusal)).not.toContain('swapped-secret-name');
  });
});

describe('the allowlist file', () => {
  it('reads a complete row: the positive control', () => {
    expect(parseServerAllowlist({ servers: [serverRow()] })).toMatchObject({ ok: true });
  });

  it.each([
    ['an unknown field', serverRow({ autoInstall: true })],
    ['a hash that is not sha256', serverRow({ manifestHash: 'abc' })],
    ['a wildcard server id', serverRow({ serverId: 'mail-*' })],
    ['a tool with no cost', serverRow({ tools: { search_mail: { action: 'bridge-read', descriptorHash: DESCRIPTOR } } })],
    ['a tool with a negative cost', serverRow({ tools: { search_mail: { action: 'bridge-read', cost: -1, descriptorHash: DESCRIPTOR } } })],
    ['a tool with no descriptor pin, which would leave it open to a rug pull', serverRow({ tools: { search_mail: { action: 'bridge-read', cost: 1 } } })],
    ['a tool whose descriptor pin is not a sha256', serverRow({ tools: { search_mail: { action: 'bridge-read', cost: 1, descriptorHash: 'abc' } } })],
    ['a call cap of zero', serverRow({ callLimit: 0 })],
    ['a spend window under a minute', serverRow({ spendWindowMs: 1000 })],
    ['a spend limit of zero, which would mean no limit upstream', serverRow({ spendLimit: 0 })],
    ['a missing spend limit', serverRow({ spendLimit: undefined })],
    ['a tool mapped to no action', serverRow({ tools: { search_mail: { action: '', cost: 1, descriptorHash: DESCRIPTOR } } })],
    ['a wildcard tool name', serverRow({ tools: { '*': { action: 'bridge-read', cost: 1, descriptorHash: DESCRIPTOR } } })],
    ['no connector', serverRow({ connectorId: undefined })],
  ])('refuses %s', (_label, row) => {
    expect(parseServerAllowlist({ servers: [row] })).toMatchObject({ ok: false });
  });

  it('refuses a duplicate server for one tenant', () => {
    expect(parseServerAllowlist({ servers: [serverRow(), serverRow()] })).toMatchObject({ ok: false });
  });

  it('refuses a file that is not a list of servers', () => {
    expect(parseServerAllowlist({ servers: 'all' })).toMatchObject({ ok: false });
    expect(parseServerAllowlist(null)).toMatchObject({ ok: false });
  });
});

describe('connection keys', () => {
  it('a key is the tenant and the server, and splits back: the positive control', () => {
    const key = serverKeyOf('agency-business', 'mail-reader');
    expect(key).toBe('agency-business/mail-reader');
    expect(splitServerKey(key as string)).toEqual({ tenant: 'agency-business', serverId: 'mail-reader' });
  });

  it('refuses a key built from a bad tenant or server id', () => {
    expect(serverKeyOf('Agency', 'mail-reader')).toBeNull();
    expect(serverKeyOf('agency-business', 'a/b')).toBeNull();
    expect(splitServerKey('a/b/c')).toBeNull();
  });

  it('two tenants with the same server name are two connections, and neither sees the other', () => {
    const live = [serverKeyOf('owner-personal', 'mail-reader') as string];
    expect(resolveServerKey(live, 'owner-personal', 'mail-reader')).toBe('owner-personal/mail-reader');
    expect(resolveServerKey(live, 'agency-business', 'mail-reader')).toBeNull();
  });
});
