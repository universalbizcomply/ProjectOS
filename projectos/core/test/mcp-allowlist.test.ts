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

describe('manifest hygiene (M3, N5)', () => {
  const FAKE_KEY = ['sk', 'ant', 'api03', 'abcdefghij', 'klmnopqrst', 'uvwxyz0123'].join('-');
  const NODE = 'C:/Program Files/nodejs/node.exe';
  const manifestWith = (over: Record<string, unknown>) => parseManifest({ ...MANIFEST, ...over });

  it.each([
    'PATH', 'PATHEXT', 'COMSPEC', 'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP', 'PERL5OPT', 'RUBYOPT', 'BASH_ENV', 'ENV',
    'JAVA_TOOL_OPTIONS', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NPM_CONFIG_REGISTRY', 'NPM_CONFIG_USERCONFIG', 'GIT_SSH_COMMAND', 'GIT_CONFIG_GLOBAL',
  ])('refuses the environment name %s, which changes what a program loads or where it talks', (name) => {
    expect(manifestWith({ envNames: [name] })).toMatchObject({ ok: false });
  });

  it('refuses the same names in lower case, and the underscore-first Java one', () => {
    expect(manifestWith({ envNames: ['http_proxy'] })).toMatchObject({ ok: false });
    expect(manifestWith({ envNames: ['_JAVA_OPTIONS'] })).toMatchObject({ ok: false });
  });

  it('an environment name that is not on the list, still passes', () => {
    expect(manifestWith({ envNames: ['MAIL_TOKEN_REF', 'LOG_LEVEL'] })).toMatchObject({ ok: true });
  });

  it.each([
    ['a caret in the command', { command: 'C:/tools/a^b.exe' }],
    ['a percent sign in the command', { command: 'C:/tools/%TEMP%/a.exe' }],
    ['an ampersand in an argument', { args: ['a&b'] }],
    ['a pipe in an argument', { args: ['a|b'] }],
    ['a parenthesis in an argument', { args: ['(a)'] }],
    ['a caret in an argument', { args: ['a^b'] }],
    ['a right-to-left override in an argument', { args: ['--name=\u202egpj.exe'] }],
    ['a zero-width space in the command', { command: 'C:/tools/mcp/mail\u200b-reader.exe' }],
    ['a control character above 0x7f in an argument', { args: ['a\u0085b'] }],
    ['a credential in an argument', { args: [`--key=${FAKE_KEY}`] }],
  ])('refuses %s', (_label, over) => {
    expect(manifestWith(over)).toMatchObject({ ok: false });
  });

  it.each([
    ['a bare name, which the search path decides', { command: 'mail-reader' }],
    ['a relative path', { command: './mail-reader.exe' }],
    ['a path that climbs from the working directory', { command: '../tools/mail-reader.exe' }],
    ['a home-relative path', { command: '~/tools/mail-reader.exe' }],
  ])('refuses a command that is not an absolute path: %s (N5)', (_label, over) => {
    expect(manifestWith(over)).toMatchObject({ ok: false });
  });

  it.each([
    ['an absolute Windows path', 'C:/tools/mcp/mail-reader.exe'],
    ['an absolute Windows path with backslashes', 'C:\\tools\\mcp\\mail-reader.exe'],
    ['an absolute POSIX path', '/opt/mcp/mail-reader'],
    ['a UNC path', '\\\\server\\share\\mail-reader.exe'],
  ])('accepts %s: the positive control', (_label, command) => {
    expect(manifestWith({ command })).toMatchObject({ ok: true });
  });

  it.each([
    'env', 'xargs', 'nohup', 'busybox', 'wsl', 'nice', 'timeout', 'sudo', 'doas', 'start', 'cmd', 'runas', 'stdbuf', 'setsid',
  ])('refuses the launcher wrapper %s, by its name wherever it is, whatever its extension or a trailing dot (N5)', (name) => {
    expect(manifestWith({ command: `/usr/bin/${name}`, args: ['mail-reader'] })).toMatchObject({ ok: false });
    expect(manifestWith({ command: `C:/Windows/System32/${name}.exe`, args: ['x'] })).toMatchObject({ ok: false });
    expect(manifestWith({ command: `C:/Windows/System32/${name}.EXE.`, args: ['x'] })).toMatchObject({ ok: false });
    expect(manifestWith({ command: `C:/Windows/System32/${name}. `, args: ['x'] })).toMatchObject({ ok: false });
  });

  it.each([
    'npx', 'npm', 'pnpm', 'pnpx', 'yarn', 'bunx', 'bun', 'uvx', 'uv', 'pipx', 'deno',
  ])('refuses the package runner %s as an absolute path (N5)', (name) => {
    expect(manifestWith({ command: `/usr/local/bin/${name}`, args: ['some-server'] })).toMatchObject({ ok: false });
    expect(manifestWith({ command: `C:/Program Files/nodejs/${name}.cmd`, args: ['x'] })).toMatchObject({ ok: false });
  });

  it.each([
    ['sh -c', '/bin/sh', ['-c', 'x']],
    ['bash -lc', '/bin/bash', ['-lc', 'x']],
    ['zsh -ic', '/bin/zsh', ['-ic', 'x']],
    ['dash -c', '/bin/dash', ['-c', 'x']],
    ['ksh -c', '/bin/ksh', ['-c', 'x']],
    ['bash -xc', '/bin/bash', ['-xc', 'x']],
    ['node -e', NODE, ['-e', 'run()']],
    ['node --eval', NODE, ['--eval', 'run()']],
    ['node --eval=', NODE, ['--eval=run()']],
    ['node -p', NODE, ['-p', '1']],
    ['node -pe', NODE, ['-pe', '1']],
    ['node --print', NODE, ['--print', '1']],
    ['node18 -e', 'C:/tools/node18.exe', ['-e', 'x']],
    ['python3 -c', '/usr/bin/python3', ['-c', 'x']],
    ['python3.11 -c', '/usr/bin/python3.11', ['-c', 'x']],
    ['python -m', '/usr/bin/python', ['-m', 'http.server']],
    ['python -Ic', '/usr/bin/python', ['-Ic', 'x']],
    ['pythonw -c', 'C:/Python/pythonw.exe', ['-c', 'x']],
    ['py -c', 'C:/Windows/py.exe', ['-c', 'x']],
    ['perl -e', '/usr/bin/perl', ['-e', 'x']],
    ['perl -le', '/usr/bin/perl', ['-le', 'x']],
    ['ruby -e', '/usr/bin/ruby', ['-e', 'x']],
    ['php -r', '/usr/bin/php', ['-r', 'x']],
    ['powershell -Command', 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-Command', 'x']],
    ['powershell -c', 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-c', 'x']],
    ['powershell -com', 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-com', 'x']],
    ['pwsh -enc', 'C:/Program Files/PowerShell/7/pwsh.exe', ['-enc', 'AAAA']],
    ['pwsh -EncodedCommand', 'C:/Program Files/PowerShell/7/pwsh.exe', ['-EncodedCommand', 'AAAA']],
    ['pwsh /c', 'C:/Program Files/PowerShell/7/pwsh.exe', ['/c', 'x']],
  ])('refuses an interpreter given text to run: %s (N5)', (_label, command, args) => {
    expect(manifestWith({ command, args })).toMatchObject({ ok: false });
  });

  it('refuses an interpreter given no script at all, and one named with trailing spaces', () => {
    expect(manifestWith({ command: NODE, args: [] })).toMatchObject({ ok: false });
    expect(manifestWith({ command: 'C:/Program Files/nodejs/node.exe  ', args: ['-e', 'x'] })).toMatchObject({ ok: false });
  });

  it.each([
    ['an auto-yes flag', ['-y']],
    ['a --yes flag', ['--yes']],
    ['a floating version', ['server@latest']],
    ['a moving tag', ['server@next']],
  ])('refuses %s (M3)', (_label, args) => {
    expect(manifestWith({ args })).toMatchObject({ ok: false });
  });

  it('allows an interpreter that runs a named script, and a plain pinned binary: the positive control', () => {
    expect(manifestWith({ command: NODE, args: ['C:/tools/mcp/server.js'] })).toMatchObject({ ok: true });
    expect(manifestWith({ command: '/usr/bin/python3.11', args: ['/opt/mcp/server.py'] })).toMatchObject({ ok: true });
    expect(manifestWith({})).toMatchObject({ ok: true });
  });

  it('a binary whose own name ends in a digit is not mistaken for an interpreter', () => {
    expect(manifestWith({ command: 'C:/tools/mcp/mail-reader2.exe', args: ['-c', 'config.json'] })).toMatchObject({ ok: true });
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
