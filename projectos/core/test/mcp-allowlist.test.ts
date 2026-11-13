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

const serverRow = (over: Record<string, unknown> = {}) => ({
  tenant: 'agency-business',
  serverId: 'mail-reader',
  manifestHash: manifestHashOf(manifestOf()),
  connectorId: 'fixture-mail',
  spendLimit: 5_000,
  tools: { search_mail: { action: 'bridge-read', cost: 100 } },
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
    ['a tool with no cost', serverRow({ tools: { search_mail: { action: 'bridge-read' } } })],
    ['a tool with a negative cost', serverRow({ tools: { search_mail: { action: 'bridge-read', cost: -1 } } })],
    ['a spend limit of zero, which would mean no limit upstream', serverRow({ spendLimit: 0 })],
    ['a missing spend limit', serverRow({ spendLimit: undefined })],
    ['a tool mapped to no action', serverRow({ tools: { search_mail: { action: '', cost: 1 } } })],
    ['a wildcard tool name', serverRow({ tools: { '*': { action: 'bridge-read', cost: 1 } } })],
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
