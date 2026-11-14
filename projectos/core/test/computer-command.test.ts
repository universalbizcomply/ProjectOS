import { describe, expect, it } from 'vitest';
import {
  admitExecEnvNames,
  analyzeCommandLine,
  isPreparedExec,
  prepareExecCommand,
  resolveWrapperPlan,
} from '../src/computer/index.js';
import { AGENT, GIT, REPO, TABLE, polygo, preparedOf, projectos, request, resolverOf } from './computer-support.js';

const refusedFeatures = (line: string, allowed: readonly ('redirection' | 'glob' | 'chaining')[] = []): string => {
  const result = analyzeCommandLine(line, allowed);
  return result.ok ? 'ok' : result.features.join(',');
};
const plan = (...argv: string[]): string => {
  const result = resolveWrapperPlan(argv);
  return result.ok ? `ok:${result.argv.join(' ')}` : `blocked:${result.code}:${result.wrapper}`;
};

describe('command lines, launchers, environment names and prepared commands', () => {
  it('reads one plain command line into its words: the positive control', () => {
    expect(analyzeCommandLine('git status')).toMatchObject({ ok: true, segments: [['git', 'status']], features: [] });
    expect(analyzeCommandLine('git commit -m "a b" \'c d\' e\\ f')).toMatchObject({ ok: true, segments: [['git', 'commit', '-m', 'a b', 'c d', 'e f']] });
    expect(analyzeCommandLine('git log ""')).toMatchObject({ ok: true, segments: [['git', 'log', '']] });
  });

  it('refuses chaining, substitution and grouping, even when the caller says it may allow them', () => {
    for (const line of ['git status; rm -rf x', 'git status && rm x', 'git status | cat', 'git status & ', 'git status\nrm x']) {
      expect(refusedFeatures(line)).toContain('chaining');
      expect(refusedFeatures(line, ['chaining'])).toContain('chaining');
    }
    expect(refusedFeatures('echo $(id)', ['glob', 'redirection'])).toContain('substitution');
    expect(refusedFeatures('echo `id`', ['glob', 'redirection'])).toContain('substitution');
    expect(refusedFeatures('echo "$HOME"', ['glob', 'redirection'])).toContain('substitution');
    expect(refusedFeatures('echo ${HOME}', ['glob', 'redirection'])).toContain('substitution');
    expect(refusedFeatures('git (status)', ['glob', 'redirection'])).toContain('grouping');
  });

  it('refuses redirection and globs unless the caller allows them, and keeps their text literal when it does', () => {
    expect(refusedFeatures('cat a > b')).toBe('redirection');
    expect(refusedFeatures('ls *.ts')).toBe('glob');
    expect(refusedFeatures('ls ~')).toBe('glob');
    expect(analyzeCommandLine('cat a > b', ['redirection'])).toMatchObject({ ok: true, segments: [['cat', 'a', '>', 'b']], features: ['redirection'] });
    expect(analyzeCommandLine('ls *.ts', ['glob'])).toMatchObject({ ok: true, segments: [['ls', '*.ts']], features: ['glob'] });
    expect(analyzeCommandLine("ls '*.ts'")).toMatchObject({ ok: true, segments: [['ls', '*.ts']] });
  });

  it('refuses a line it cannot read completely: an open quote, a trailing backslash, cmd and history syntax, a hidden space', () => {
    for (const line of ['git "status', "git 'status", 'git status\\', 'echo %PATH%', 'echo ^&', 'echo !x', '# comment', 'git\u00a0status', 'git\u200bstatus', 'git\u0007status', '', '   ', 'a ;; b', 'a;']) {
      expect(refusedFeatures(line, ['glob', 'redirection'])).toContain('unparsed');
    }
    expect(refusedFeatures('x'.repeat(9000))).toBe('unparsed');
    expect(refusedFeatures(undefined as unknown as string)).toBe('unparsed');
  });

  it('unwraps env, nohup, nice, timeout, stdbuf and busybox to the command that really runs', () => {
    expect(plan('env', 'git', 'status')).toBe('ok:git status');
    expect(plan('env', '--', 'git', 'status')).toBe('ok:git status');
    expect(plan('nohup', 'git', 'status')).toBe('ok:git status');
    expect(plan('nice', '-n', '5', 'git', 'status')).toBe('ok:git status');
    expect(plan('timeout', '--foreground', '-k', '5s', '30', 'git', 'status')).toBe('ok:git status');
    expect(plan('stdbuf', '-o', 'L', 'git', 'status')).toBe('ok:git status');
    expect(plan('busybox', 'ls', '-l')).toBe('ok:ls -l');
    expect(plan('/usr/bin/env', 'nohup', 'timeout', '30', 'git', 'status')).toBe('ok:git status');
  });

  it('unwraps a plain inline shell command to the command it holds, and no other shell form', () => {
    expect(plan('bash', '-c', 'git status')).toBe('ok:git status');
    expect(plan('/bin/sh', '-c', 'git "log" -1')).toBe('ok:git log -1');
    expect(plan('cmd', '/c', 'git status')).toBe('ok:git status');
    expect(plan('CMD.EXE', '/C', 'git status')).toBe('ok:git status');
    expect(plan('powershell', '-NoProfile', '-Command', 'git status')).toBe('ok:git status');
    expect(plan('pwsh', '-c', 'git status')).toBe('ok:git status');
    expect(plan('bash', '-lc', 'git status')).toBe('blocked:SHELL_FORM:bash');
    expect(plan('bash', '-c', 'git status', 'extra')).toBe('blocked:SHELL_FORM:bash');
    expect(plan('sh', 'script.sh')).toBe('blocked:SHELL_FORM:sh');
    expect(plan('bash', '-c', 'git status; id')).toBe('blocked:INLINE_SYNTAX:bash');
    expect(plan('sh', '-c', 'echo $(id)')).toBe('blocked:INLINE_SYNTAX:sh');
    expect(plan('cmd', '/c', 'git status & calc')).toBe('blocked:INLINE_SYNTAX:cmd');
    expect(plan('powershell', '-enc', 'ZwBpAHQA')).toBe('blocked:POWERSHELL_FORM:powershell');
    expect(plan('powershell', '-EncodedCommand', 'ZwBpAHQA')).toBe('blocked:POWERSHELL_FORM:powershell');
    expect(plan('pwsh', '-File', 'x.ps1')).toBe('blocked:POWERSHELL_FORM:pwsh');
  });

  it('blocks an elevation, an interpreter and a launcher that runs what it is handed', () => {
    expect(plan('sudo', 'git', 'status')).toBe('blocked:ELEVATION:sudo');
    expect(plan('runas', '/user:a', 'git')).toBe('blocked:ELEVATION:runas');
    expect(plan('node', '-e', '1')).toBe('blocked:INTERPRETER:node');
    expect(plan('python3', '-c', '1')).toBe('blocked:INTERPRETER:python');
    expect(plan('perl', '-e', '1')).toBe('blocked:INTERPRETER:perl');
    expect(plan('xargs', 'git')).toBe('blocked:LAUNCHER:xargs');
    expect(plan('wsl', 'git')).toBe('blocked:LAUNCHER:wsl');
    expect(plan('wsl.exe', '-e', 'git')).toBe('blocked:LAUNCHER:wsl');
    expect(plan('cmd', '/c', 'start calc')).toBe('blocked:LAUNCHER:start');
    expect(plan('env', 'nohup', 'sudo', 'git')).toBe('blocked:ELEVATION:sudo');
    expect(plan('bash', '-c', 'node -e 1')).toBe('blocked:INTERPRETER:node');
  });

  it('blocks env with an option or an assignment, because a value never rides in a request', () => {
    expect(plan('env', 'FOO=bar', 'git')).toBe('blocked:ENV_FORM:env');
    expect(plan('env', '-i', 'git')).toBe('blocked:ENV_FORM:env');
    expect(plan('env', '-S', 'git status')).toBe('blocked:ENV_FORM:env');
    expect(plan('env')).toBe('blocked:ENV_FORM:env');
  });

  it('blocks a launcher chain past the depth of four rather than reading the rest', () => {
    expect(plan('env', 'env', 'env', 'env', 'git')).toBe('ok:git');
    expect(plan('env', 'env', 'env', 'env', 'env', 'git')).toBe('blocked:DEPTH:env');
  });

  it('takes environment names only: a value, a duplicate, a bad name or a loader name refuses the whole', () => {
    expect(admitExecEnvNames(['LANG', 'CI'])).toEqual({ ok: true, names: ['CI', 'LANG'] });
    expect(admitExecEnvNames({ LANG: 'C' })).toMatchObject({ ok: false, code: 'ENV_NOT_NAMES' });
    expect(admitExecEnvNames(['LANG=C'])).toMatchObject({ ok: false, code: 'ENV_NAME_FORM' });
    expect(admitExecEnvNames(['LANG', 'LANG'])).toMatchObject({ ok: false, code: 'ENV_DUPLICATE' });
    expect(admitExecEnvNames(Array.from({ length: 33 }, (_, index) => `V${index}`))).toMatchObject({ ok: false, code: 'ENV_TOO_MANY' });
    expect(admitExecEnvNames([7])).toMatchObject({ ok: false, code: 'ENV_NOT_NAMES' });
  });

  it('denies every loader and hook name, in any case, and every name that looks like a credential', () => {
    const denied = [
      'PATH', 'Path', 'PATHEXT', 'COMSPEC', 'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'PYTHONPATH', 'PYTHONSTARTUP',
      'PERL5OPT', 'RUBYOPT', 'BASH_ENV', 'ENV', 'HTTP_PROXY', 'https_proxy', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'GIT_SSH_COMMAND', 'GIT_CONFIG_COUNT',
      'NPM_CONFIG_REGISTRY', 'npm_config_prefix', 'JAVA_TOOL_OPTIONS', 'HOME', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'DB_PASSWORD', 'STRIPE_API_KEY',
    ];
    for (const name of denied) expect(admitExecEnvNames([name]), name).toMatchObject({ ok: false, code: 'ENV_DENIED' });
  });

  it('prepares one command from an argv, a launcher chain or a line, to the same real command', () => {
    const binding = polygo();
    const direct = preparedOf(binding);
    expect(direct.argv).toEqual([GIT, 'status']);
    expect(direct.executable).toBe(GIT);
    expect(preparedOf(binding, { argv: undefined, commandLine: 'git status' }).argv).toEqual([GIT, 'status']);
    const wrapped = preparedOf(binding, { argv: ['env', 'git', 'status'] });
    expect(wrapped.argv).toEqual([GIT, 'status']);
    expect(wrapped.wrapperChain).toEqual(['env']);
    expect(wrapped.hash).not.toBe(direct.hash);
    expect(isPreparedExec(direct)).toBe(true);
    expect(isPreparedExec({ ...direct })).toBe(false);
  });

  it('gives a command that differs by one byte in any field another hash', () => {
    const binding = polygo();
    const base = preparedOf(binding);
    const changes = [
      { argv: ['git', 'statu'] },
      { argv: ['git', 'status', ''] },
      { argv: ['git', 'status '] },
      { cwd: '/work/polygo2' },
      { cwd: '/work/Polygo' },
      { envNames: ['CI'] },
      { timeoutMs: 30_001 },
      { maxOutputBytes: 65_537 },
      { agentId: 'workers' },
    ];
    const hashes = new Set([base.hash, ...changes.map((change) => preparedOf(binding, change).hash)]);
    expect(hashes.size).toBe(changes.length + 1);
    expect(preparedOf(binding).hash).toBe(base.hash);
    expect(preparedOf(binding, { argv: ['git', 'status'] }, resolverOf({ git: '/usr/local/bin/git' })).hash).not.toBe(base.hash);
  });

  it('cannot move a boundary between two arguments: the encoding writes each word as its own string', () => {
    const binding = polygo();
    const joined = preparedOf(binding, { argv: ['git', 'log', 'a b'] });
    const split = preparedOf(binding, { argv: ['git', 'log', 'a', 'b'] });
    expect(joined.hash).not.toBe(split.hash);
  });

  it('hashes under the tenant and the project, so the same command in two scopes never shares a hash', () => {
    expect(preparedOf(polygo()).hash).not.toBe(preparedOf(projectos()).hash);
  });

  it('refuses a request with an unknown field, a getter, both forms or neither, so no flag rides along', () => {
    const binding = polygo();
    const resolver = resolverOf(TABLE);
    const code = (value: unknown): string => {
      const result = prepareExecCommand(binding, value, resolver, AGENT);
      return result.ok ? 'ok' : result.code;
    };
    expect(code(request())).toBe('ok');
    expect(code(request({ elevated: true }))).toBe('REQUEST_SHAPE');
    expect(code(request({ tenant: 'agency-business' }))).toBe('REQUEST_SHAPE');
    expect(code(request({ argv: undefined }))).toBe('COMMAND_FORM');
    expect(code(request({ commandLine: 'git status' }))).toBe('COMMAND_FORM');
    const getter = { ...request() };
    Object.defineProperty(getter, 'cwd', { enumerable: true, get: () => REPO });
    expect(code(getter)).toBe('REQUEST_SHAPE');
    expect(code(null)).toBe('REQUEST_SHAPE');
    expect(code([])).toBe('REQUEST_SHAPE');
  });

  it('refuses limits past the caps, fractions, NaN and a limit that is not a number, instead of clamping them', () => {
    const binding = polygo();
    const code = (change: Record<string, unknown>): string => {
      const result = prepareExecCommand(binding, request(change), resolverOf(TABLE), AGENT);
      return result.ok ? 'ok' : result.code;
    };
    for (const timeoutMs of [0, -1, 600_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '30000', null, true]) expect(code({ timeoutMs }), String(timeoutMs)).toBe('LIMITS');
    for (const maxOutputBytes of [0, 1_048_577, 0.5, Number.NaN, '1', undefined]) expect(code({ maxOutputBytes }), String(maxOutputBytes)).toBe('LIMITS');
    expect(code({ timeoutMs: 600_000, maxOutputBytes: 1_048_576 })).toBe('ok');
  });

  it('refuses a working directory that is relative, holds .. or a control character, and an agent id that is not a word', () => {
    const binding = polygo();
    const code = (change: Record<string, unknown>): string => {
      const result = prepareExecCommand(binding, request(change), resolverOf(TABLE), AGENT);
      return result.ok ? 'ok' : result.code;
    };
    for (const cwd of ['work', './work', '/work/../etc', 'C:work', '/work\u0000', '', 7]) expect(code({ cwd }), String(cwd)).toBe('CWD');
    for (const agentId of ['Worker', '1worker', 'a b', '', 'a'.repeat(33), 7]) expect(prepareExecCommand(binding, request(), resolverOf(TABLE), agentId as string), String(agentId)).toMatchObject({ ok: false, code: 'AGENT_ID' });
    expect(code({ agentId: 'worker' }), 'the agent is never a request field').toBe('REQUEST_SHAPE');
    expect(code({ cwd: 'C:\\work\\polygo' })).toBe('ok');
  });

  it('refuses a binding that was not derived, and a resolver that finds nothing, throws or names an alias', () => {
    const binding = polygo();
    expect(prepareExecCommand({ ...binding }, request(), resolverOf(TABLE), AGENT)).toMatchObject({ ok: false, code: 'NO_TENANT_BINDING' });
    expect(prepareExecCommand(binding, request({ argv: ['nope'] }), resolverOf(TABLE), AGENT)).toMatchObject({ ok: false, code: 'EXECUTABLE_UNRESOLVED' });
    expect(prepareExecCommand(binding, request(), { resolve: () => { throw new Error('port down'); } }, AGENT)).toMatchObject({ ok: false, code: 'EXECUTABLE_UNRESOLVED' });
    for (const alias of ['/usr/bin/../bin/git', 'C:\\PROGRA~1\\git.exe', '/usr/bin/g\u0456t', 'git', '\\\\.\\x']) {
      expect(prepareExecCommand(binding, request(), resolverOf({ git: alias }), AGENT), alias).toMatchObject({ ok: false, code: 'EXECUTABLE_PATH' });
    }
    expect(prepareExecCommand(binding, request(), { resolve: () => ({ resolvedRealPath: 7 }) }, AGENT)).toMatchObject({ ok: false, code: 'EXECUTABLE_UNRESOLVED' });
  });

  it('refuses a command whose launcher it cannot unwrap, with the launcher named, before the resolver is asked', () => {
    const binding = polygo();
    const resolver = resolverOf(TABLE);
    const result = prepareExecCommand(binding, request({ argv: ['sudo', 'git', 'status'] }), resolver, AGENT);
    expect(result).toMatchObject({ ok: false, code: 'WRAPPER' });
    expect(resolver.calls).toEqual([]);
    expect(prepareExecCommand(binding, request({ argv: undefined, commandLine: 'git status; id' }), resolver, AGENT)).toMatchObject({ ok: false, code: 'COMMAND_LINE' });
    expect(prepareExecCommand(binding, request({ argv: [] }), resolver, AGENT)).toMatchObject({ ok: false, code: 'ARGV_SHAPE' });
    expect(prepareExecCommand(binding, request({ argv: ['git', 'a\u0000b'] }), resolver, AGENT)).toMatchObject({ ok: false, code: 'ARGV_SHAPE' });
    expect(prepareExecCommand(binding, request({ argv: ['git', 7] }), resolver, AGENT)).toMatchObject({ ok: false, code: 'ARGV_SHAPE' });
    expect(prepareExecCommand(binding, request({ envNames: ['PATH'] }), resolver, AGENT)).toMatchObject({ ok: false, code: 'ENV' });
  });
});

