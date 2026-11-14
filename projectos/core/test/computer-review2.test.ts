import { describe, expect, it } from 'vitest';
import {
  DECISION_REPLAY_WINDOW_MS,
  MAX_DECISIONS_PER_SCOPE,
  analyzeCommandLine,
  compileActionPolicy,
  compileExecPolicy,
  createExecGrantStore,
  effectiveNetworkPolicy,
  egressAllowed,
  evaluateActionPolicy,
  execArgsRunSomething,
  type ActionPolicy,
  type NetworkPolicyRow,
} from '../src/computer/index.js';
import { MINUTE, NOW, decisionFor, movingClock, polygo, preparedOf, registryWith } from './computer-support.js';

const ap = (rules: unknown): ActionPolicy => {
  const result = compileActionPolicy({ rules });
  if (!result.ok) throw new Error(`action policy refused: ${result.code}: ${result.detail}`);
  return result.policy;
};
const registry = registryWith({ 'computer-click': 'P2', 'computer-type': 'P2', 'computer-key': 'P2', 'computer-read-file': 'P2', 'computer-navigate': 'P2' });
const allow = ap([{ id: 'allow-all-input', effect: 'allow', when: { tools: ['click', 'type', 'key', 'read-file', 'navigate'] } }]);
const floorOf = (raw: Record<string, unknown>): string => {
  const decision = evaluateActionPolicy(allow, registry, raw);
  return decision.allowed ? 'ok' : `${decision.code}:${decision.floor}`;
};
const click = (name: string, extra: Record<string, unknown> = {}) => ({ tool: 'click', host: 'a.example.com', element: { role: 'button', name, type: 'button' }, initiator: 'person', ...extra });
const cp = (...points: number[]): string => String.fromCodePoint(...points);

describe('review round 2, N1: every default-ignorable character, combining marks and the look-alike letters', () => {
  it('floors a word split by any default-ignorable code point', () => {
    for (const point of [0x206a, 0x2065, 0x17b4, 0x17b5, 0x180f, 0x206f, 0xfff0, 0xfff8, 0x1bca0, 0x1bca3, 0x1d173, 0x1d17a]) {
      expect(floorOf(click(`De${cp(point)}lete account`)), point.toString(16)).toBe('OWNER_DECISION_REQUIRED:destructive');
    }
  });
  it('floors a word written with a Greek capital Epsilon, a Cyrillic Ve, a combining mark or an accent', () => {
    for (const name of [`D${cp(0x395)}LETE`, `${cp(0x412)}uy now`, `De${cp(0x332)}lete`, `Del${cp(0xe9)}te`, `De${cp(0x301)}lete`, 'Deléte']) {
      expect(floorOf(click(name)), name).toBe('OWNER_DECISION_REQUIRED:destructive');
    }
    expect(floorOf(click('Next'))).toBe('ok');
  });
  it('refuses a command line holding a default-ignorable code point', () => {
    for (const point of [0x17b4, 0x2065, 0x206a, 0x180f, 0xfff0]) {
      expect(analyzeCommandLine(`ls ${cp(point)}-l`, ['glob', 'redirection']).ok, point.toString(16)).toBe(false);
    }
    expect(analyzeCommandLine('ls -l').ok).toBe(true);
  });
});

describe('review round 2, N2: a key spelling this module does not recognise is never plain typing', () => {
  const key = (k: string) => floorOf({ tool: 'key', host: 'a.example.com', key: k, initiator: 'person' });
  it('reads every spacing, separator and prefix of Enter and Alt+F4 as activation', () => {
    for (const k of ['ctrl + enter', 'enter ', ' enter', 'ctrl-enter', 'Alt + F4', 'Key.enter', 'keys.Enter', 'ctrl_enter', 'CTRL  +  ENTER', 'alt-f4', 'Key.Delete']) {
      expect(key(k), k).toBe('OWNER_DECISION_REQUIRED:destructive');
    }
  });
  it('refuses a spelling it cannot read, instead of reading it as typing', () => {
    for (const k of ['entr', 'ctrl+', 'ctrl+foo', 'ctrll+enter', 'return key', 'press enter', '', 'enterenter']) {
      const decision = evaluateActionPolicy(allow, registry, { tool: 'key', host: 'a.example.com', key: k, initiator: 'person' });
      expect(decision.allowed, JSON.stringify(k)).toBe(false);
      expect(decision.code, JSON.stringify(k)).toBe('CONTEXT_INVALID');
    }
  });
  it('keeps plain printable keys and ordinary chords as plain typing', () => {
    for (const k of ['a', 'A', '1', '/', 'ctrl+c', 'Ctrl + C', 'shift+a', 'f5', 'tab', 'Escape', 'ArrowLeft', '-', '+', 'ctrl+-', 'ctrl++']) expect(key(k), k).toBe('ok');
  });
});

describe('review round 2, N3: anyArgs is refused for a tool that can run or write what it is handed', () => {
  const entry = (pattern: string) => compileExecPolicy({ mode: 'allowlist', allowlist: [{ pattern, anyArgs: true, cwdPrefixes: ['/work'] }] });
  it('refuses anyArgs at compile time for the named tools and the interpreters', () => {
    for (const tool of ['curl', 'wget', 'tar', 'git', 'find', 'xargs', 'awk', 'gawk', 'sed', 'gsed', 'make', 'gmake', 'rsync', 'ssh', 'scp', 'zip', 'unzip', '7z', 'node', 'python3', 'perl', 'bash']) {
      expect(entry(`/usr/bin/${tool}`), tool).toMatchObject({ ok: false, code: 'ENTRY_OPEN_ARGS' });
    }
    expect(entry('/usr/bin/*')).toMatchObject({ ok: false, code: 'ENTRY_OPEN_ARGS' });
    expect(entry('/usr/bin/g*')).toMatchObject({ ok: false, code: 'ENTRY_OPEN_ARGS' });
  });
  it('still allows anyArgs for a tool that cannot, and exact arguments for the others', () => {
    expect(entry('/bin/ls').ok).toBe(true);
    expect(compileExecPolicy({ mode: 'allowlist', allowlist: [{ pattern: '/usr/bin/curl', args: ['-sS', 'https://a.example.com'], cwdPrefixes: ['/work'] }] }).ok).toBe(true);
  });
  it('refuses the argument forms that run or write, anywhere in an argument, combined or abbreviated (second defence)', () => {
    const bad: [string, string[]][] = [
      ['curl', ['-sSLO', 'u']], ['curl', ['-sSLo', 'x', 'u']], ['curl', ['--output=x', 'u']], ['curl', ['--out=x', 'u']], ['wget', ['-qO', '-', 'u']], ['wget', ['--exe', 'x']],
      ['wget', ['--execute=x']], ['tar', ['-xIsh', 'a']], ['tar', ['--checkpoint-ac=exec=sh']], ['tar', ['--to-com=sh']], ['tar', ['--use-compress-program=sh']],
      ['git', ['rebase', '-x', 'sh']], ['git', ['bisect', 'run', 'sh']], ['git', ['diff', '--output=x']], ['git', ['config', 'alias.x', '!sh']], ['git', ['-ccore.pager=x', 'log']],
      ['find', ['.', '-exec', 'sh', ';']], ['find', ['.', '-delete']], ['gsed', ['-i', 's/a/b/', 'f']], ['gmake', ['all']],
    ];
    for (const [tool, args] of bad) expect(execArgsRunSomething(tool, args), `${tool} ${args.join(' ')}`).toBe(true);
    for (const [tool, args] of [['ls', ['-la']], ['curl', ['-sS', 'u']], ['tar', ['-tf', 'a.tar']], ['git', ['status']]] as const) {
      expect(execArgsRunSomething(tool, [...args]), `${tool} ${args.join(' ')}`).toBe(false);
    }
  });
});

describe('review round 2, N4: the destructive floor matches stems and compounds, confirmations, navigation and whole paths', () => {
  it('floors a stem, a plural, a participle and a camelCase, snake or kebab compound', () => {
    for (const name of ['Payments', 'Deleting', 'Submitted', 'DeleteAccount', 'removeItem', 'delete_account', 'delete-account', 'Place your order', 'Purchased', 'Withdrawals', 'confirmPayment']) {
      expect(floorOf(click(name)), name).toBe('OWNER_DECISION_REQUIRED:destructive');
    }
    expect(floorOf(click('Next'))).toBe('ok');
    expect(floorOf(click('Information'))).toBe('ok');
  });
  it('floors a generic confirmation button on a click, and leaves ordinary typing alone', () => {
    for (const name of ['OK', 'Yes', 'Allow', 'Accept', 'Continue', 'Agree', 'Accept all']) expect(floorOf(click(name)), name).toBe('OWNER_DECISION_REQUIRED:destructive');
    expect(floorOf({ tool: 'type', host: 'a.example.com', element: { role: 'textbox', name: 'q' }, text: 'ok', initiator: 'person' })).toBe('ok');
    expect(floorOf({ tool: 'type', host: 'a.example.com', element: { role: 'textbox', name: 'Allow list' }, text: 'yes', initiator: 'person' })).toBe('ok');
  });
  it('floors a navigation whose url path names an irreversible action', () => {
    const nav = (url: string) => floorOf({ tool: 'navigate', host: 'a.example.com', url, initiator: 'agent' });
    for (const url of ['https://a.example.com/logout', 'https://a.example.com/account/delete', 'https://a.example.com/items/remove', 'https://a.example.com/pay', 'https://a.example.com/purchase/42', 'https://a.example.com/order/confirm']) {
      expect(nav(url), url).toBe('OWNER_DECISION_REQUIRED:destructive');
    }
    expect(nav('https://a.example.com/inbox')).toBe('ok');
  });
  it('tests credential words on the whole path and floors the wider credential paths', () => {
    const read = (path: string) => floorOf({ tool: 'read-file', file: { path }, initiator: 'agent' });
    for (const path of ['docs/passwords/list.txt', 'docs/secrets/a.md', 'a/tokens/x', 'a/credentials/y', '.git/config', 'home/kubeconfig', 'a/keystore.jks', '.config/gh/hosts.yml', 'home/.boto', 'passwords/a.txt']) {
      expect(read(path), path).toBe('OWNER_DECISION_REQUIRED:credential-adjacent');
    }
    expect(read('docs/readme.md')).toBe('ok');
  });
});

describe('review round 2, N6: a decision id is kept for its horizon, not for ever', () => {
  const ID = (n: number): string => `EXECDEC-${String(n).padStart(16, '0')}`;
  const world = () => {
    const time = movingClock();
    const store = createExecGrantStore({ clock: time.clock, verifier: () => true });
    const binding = polygo();
    const prepared = preparedOf(binding);
    return { time, store, binding, prepared };
  };
  it('mints again once the horizon of a full set has passed, and not before', () => {
    const w = world();
    for (let index = 0; index < MAX_DECISIONS_PER_SCOPE; index += 1) w.store.issue(w.binding, decisionFor(w.prepared, ID(1000 + index), { decision: 'deny' }), w.prepared, 1_000);
    expect(w.store.issue(w.binding, decisionFor(w.prepared, ID(9000)), w.prepared, 60_000)).toEqual({ ok: false, code: 'STORE_FULL' });
    w.time.advance(1_000 + DECISION_REPLAY_WINDOW_MS - 1);
    expect(w.store.issue(w.binding, decisionFor(w.prepared, ID(9000)), w.prepared, 60_000)).toEqual({ ok: false, code: 'STORE_FULL' });
    w.time.advance(1);
    expect(w.store.issue(w.binding, decisionFor(w.prepared, ID(9000)), w.prepared, 60_000).ok).toBe(true);
  });
  it('never mints a decision id twice inside its horizon, and releases it after', () => {
    const w = world();
    const first = w.store.issue(w.binding, decisionFor(w.prepared, ID(1)), w.prepared, 5 * MINUTE);
    expect(first.ok).toBe(true);
    w.time.advance(5 * MINUTE + DECISION_REPLAY_WINDOW_MS - 1);
    expect(w.store.issue(w.binding, decisionFor(w.prepared, ID(1)), w.prepared, 5 * MINUTE)).toEqual({ ok: false, code: 'DECISION_REUSED' });
    w.time.set(NOW + 5 * MINUTE + DECISION_REPLAY_WINDOW_MS);
    expect(w.store.issue(w.binding, decisionFor(w.prepared, ID(1)), w.prepared, 5 * MINUTE).ok).toBe(true);
  });
  it('uses the same horizon for a denial that never made a grant, from its own lifetime', () => {
    const w = world();
    w.store.issue(w.binding, decisionFor(w.prepared, ID(2), { decision: 'deny' }), w.prepared, 10 * MINUTE);
    w.time.advance(10 * MINUTE + DECISION_REPLAY_WINDOW_MS - 1);
    expect(w.store.issue(w.binding, decisionFor(w.prepared, ID(2)), w.prepared, MINUTE)).toEqual({ ok: false, code: 'DECISION_REUSED' });
  });
});

describe('review round 2, N7: a wildcard on a multi-tenant suffix is not a rule', () => {
  const row = (host: string): NetworkPolicyRow =>
    ({ tenant: 'owner-personal', project: 'polygo', scopeKind: 'organization', scopeId: 'org', mode: 'allowlist_only', rules: [{ host }], locked: false }) as NetworkPolicyRow;
  const policyOf = (host: string) => effectiveNetworkPolicy(polygo(), [row(host)], { groups: [] }, true);
  it('refuses a wildcard on the named hosting suffixes', () => {
    for (const suffix of [
      'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'appspot.com',
      'firebaseapp.com', 'web.app', 'fly.dev', 'onrender.com', 'repl.co', 'glitch.me', 'blogspot.com', 's3.amazonaws.com', 'co.uk',
    ]) {
      expect(policyOf(`*.${suffix}`).from, suffix).toMatch(/refused/);
    }
  });
  it('still allows an exact host on those suffixes, and a wildcard on an ordinary domain', () => {
    expect(egressAllowed(policyOf('my-app.vercel.app'), 'my-app.vercel.app')).toBe(true);
    expect(egressAllowed(policyOf('user.github.io'), 'user.github.io')).toBe(true);
    expect(policyOf('*.example.com').mode).toBe('allowlist_only');
  });
});
