import { describe, expect, it } from 'vitest';
import {
  compileActionPolicy,
  compileExecPolicy,
  effectiveNetworkPolicy,
  egressAllowed,
  evaluateActionPolicy,
  evaluateExecPolicy,
  isExecLaunchPlan,
  planAllowlistedExec,
  readActionContext,
  type ActionPolicy,
  type ExecPolicy,
  type NetworkPolicyRow,
} from '../src/computer/index.js';
import { GIT, committedRegistry, movingClock, polygo, preparedOf, projectos, registryWith } from './computer-support.js';

const execPolicy = (raw: unknown): ExecPolicy => {
  const result = compileExecPolicy(raw);
  if (!result.ok) throw new Error(`the control exec policy was refused: ${result.code}: ${result.detail}`);
  return result.policy;
};
const actionPolicy = (raw: unknown): ActionPolicy => {
  const result = compileActionPolicy(raw);
  if (!result.ok) throw new Error(`the control action policy was refused: ${result.code}: ${result.detail}`);
  return result.policy;
};
const GIT_ENTRY = { pattern: GIT, args: ['status'], cwdPrefixes: ['/work'] };
const unattended = registryWith({ 'exec-command': 'P3' });
const refusalOf = (raw: unknown): string => {
  const result = compileExecPolicy(raw);
  return result.ok ? 'ok' : result.code;
};

describe('exec policy: default deny, an allowlist hit is not a grant, and the class is the registry\'s', () => {
  it('answers allowlist-hit for an exact executable and exact arguments under a class that runs unattended: the control', () => {
    const decision = evaluateExecPolicy(execPolicy({ mode: 'allowlist', allowlist: [GIT_ENTRY] }), unattended, preparedOf(polygo()));
    expect(decision).toEqual({ outcome: 'allowlist-hit', code: 'ALLOWLIST_HIT', matched: GIT, actionClass: 'P3' });
  });

  it('refuses a command no entry allows, in allowlist mode, and asks the owner in the ask modes', () => {
    const binding = polygo();
    const other = preparedOf(binding, { argv: ['git', 'log'] });
    expect(evaluateExecPolicy(execPolicy({ mode: 'allowlist', allowlist: [GIT_ENTRY] }), unattended, other)).toMatchObject({ outcome: 'refuse', code: 'NOT_ALLOWLISTED' });
    expect(evaluateExecPolicy(execPolicy({ mode: 'ask-on-miss', allowlist: [GIT_ENTRY] }), unattended, other)).toMatchObject({ outcome: 'owner-decision-needed', code: 'NOT_ALLOWLISTED' });
    expect(evaluateExecPolicy(execPolicy({ mode: 'ask-always', allowlist: [GIT_ENTRY] }), unattended, preparedOf(binding))).toMatchObject({ outcome: 'owner-decision-needed', code: 'ASK_ALWAYS' });
    expect(evaluateExecPolicy(execPolicy({ mode: 'allowlist' }), unattended, preparedOf(binding))).toMatchObject({ outcome: 'refuse', code: 'NOT_ALLOWLISTED' });
  });

  it('refuses everything in deny mode, even an exact allowlist hit', () => {
    expect(evaluateExecPolicy(execPolicy({ mode: 'deny', allowlist: [GIT_ENTRY] }), unattended, preparedOf(polygo()))).toMatchObject({ outcome: 'refuse', code: 'MODE_DENY' });
  });

  it('matches the arguments exactly: a byte more or less, or another order, is a miss, and anyArgs is said out loud', () => {
    const binding = polygo();
    const policy = execPolicy({ mode: 'allowlist', allowlist: [GIT_ENTRY] });
    for (const argv of [['git', 'status', '-s'], ['git'], ['git', 'statu'], ['git', 'status ']]) {
      expect(evaluateExecPolicy(policy, unattended, preparedOf(binding, { argv })).outcome, argv.join(' ')).toBe('refuse');
    }
    const any = execPolicy({ mode: 'allowlist', allowlist: [{ pattern: GIT, anyArgs: true, cwdPrefixes: ['/work'] }] });
    expect(evaluateExecPolicy(any, unattended, preparedOf(binding, { argv: ['git', 'log', '-p'] })).outcome).toBe('allowlist-hit');
  });

  it('matches the real executable and never the name a request gave it: an alias of an allowlisted name is a miss', () => {
    const binding = polygo();
    const policy = execPolicy({ mode: 'allowlist', allowlist: [{ pattern: '/usr/bin/git', cwdPrefixes: ['/work'], anyArgs: true }] });
    const elsewhere = preparedOf(binding, {}, { resolve: () => ({ resolvedRealPath: '/tmp/git' }) });
    expect(evaluateExecPolicy(policy, unattended, elsewhere).outcome).toBe('refuse');
    const sameName = preparedOf(binding, { argv: ['/tmp/git', 'status'] }, { resolve: () => ({ resolvedRealPath: '/tmp/git' }) });
    expect(evaluateExecPolicy(policy, unattended, sameName).outcome).toBe('refuse');
  });

  it('judges the real command behind a launcher, and a launcher it cannot read is refused before the allowlist', () => {
    const binding = polygo();
    const policy = execPolicy({ mode: 'allowlist', allowlist: [GIT_ENTRY] });
    const wrapped = preparedOf(binding, { argv: ['env', 'git', 'status'] });
    expect(evaluateExecPolicy(policy, unattended, wrapped).outcome).toBe('allowlist-hit');
    const shell = preparedOf(binding, { argv: ['bash', '-c', 'git status'] }, { resolve: (raw) => ({ resolvedRealPath: raw === 'git' ? GIT : '/bin/bash' }) });
    expect(evaluateExecPolicy(policy, unattended, shell).outcome).toBe('allowlist-hit');
  });

  it('allows shell syntax only when the entry names it: a glob in an argument misses an entry that does not allow globs', () => {
    const binding = polygo();
    const globbed = preparedOf(binding, { argv: undefined, commandLine: 'git add *.ts' });
    const without = execPolicy({ mode: 'allowlist', allowlist: [{ pattern: GIT, anyArgs: true, cwdPrefixes: ['/work'] }] });
    const withGlob = execPolicy({ mode: 'allowlist', allowlist: [{ pattern: GIT, cwdPrefixes: ['/work'], anyArgs: true, allowSyntax: ['glob'] }] });
    expect(evaluateExecPolicy(without, unattended, globbed).outcome).toBe('refuse');
    expect(evaluateExecPolicy(withGlob, unattended, globbed).outcome).toBe('allowlist-hit');
    const redirected = preparedOf(binding, { argv: undefined, commandLine: 'git log > out.txt' });
    expect(evaluateExecPolicy(withGlob, unattended, redirected).outcome).toBe('refuse');
  });

  it('reads the class from the registry: an unregistered command is P5 and needs the owner, P3 runs, P6 never does', () => {
    const binding = polygo();
    const policy = execPolicy({ mode: 'allowlist', allowlist: [GIT_ENTRY] });
    expect(evaluateExecPolicy(policy, committedRegistry(), preparedOf(binding))).toMatchObject({ outcome: 'owner-decision-needed', code: 'CLASS_NEEDS_OWNER', actionClass: 'P5' });
    expect(evaluateExecPolicy(policy, registryWith({ 'exec-command': 'P4' }), preparedOf(binding))).toMatchObject({ outcome: 'owner-decision-needed', actionClass: 'P4' });
    expect(evaluateExecPolicy(policy, registryWith({ 'exec-command': 'P1' }), preparedOf(binding))).toMatchObject({ outcome: 'allowlist-hit', actionClass: 'P1' });
    expect(evaluateExecPolicy(policy, registryWith({ 'exec-command': 'P6' }), preparedOf(binding))).toMatchObject({ outcome: 'refuse', code: 'CLASS_PROHIBITED' });
  });

  it('refuses a policy it did not compile and a command it did not prepare', () => {
    const binding = polygo();
    const prepared = preparedOf(binding);
    const handMade = { mode: 'allowlist', entries: [] } as unknown as ExecPolicy;
    expect(evaluateExecPolicy(handMade, unattended, prepared)).toMatchObject({ outcome: 'refuse', code: 'POLICY_INVALID' });
    expect(evaluateExecPolicy(null as unknown as ExecPolicy, unattended, prepared)).toMatchObject({ outcome: 'refuse', code: 'POLICY_INVALID' });
    const policy = execPolicy({ mode: 'allowlist', allowlist: [GIT_ENTRY] });
    expect(evaluateExecPolicy(policy, unattended, { ...prepared })).toMatchObject({ outcome: 'refuse', code: 'NOT_PREPARED' });
  });

  it('refuses a whole policy for one bad entry, a mode it does not know and an entry that stands for every executable', () => {
    expect(refusalOf({ mode: 'allowlist', allowlist: [GIT_ENTRY] })).toBe('ok');
    expect(refusalOf({ mode: 'full', allowlist: [] })).toBe('POLICY_MODE');
    expect(refusalOf({ mode: 'auto', allowlist: [] })).toBe('POLICY_MODE');
    expect(refusalOf({ mode: 'allowlist', allowlist: [GIT_ENTRY, { pattern: '*', cwdPrefixes: ['/work'], anyArgs: true }] })).toBe('ENTRY_PATTERN');
    expect(refusalOf({ mode: 'allowlist', allowlist: [{ pattern: '/**', cwdPrefixes: ['/work'], anyArgs: true }] })).toBe('ENTRY_PATTERN');
    expect(refusalOf({ mode: 'allowlist', allowlist: [{ pattern: GIT, cwdPrefixes: ['/work'] }] })).toBe('ENTRY_ARGS');
    expect(refusalOf({ mode: 'allowlist', allowlist: [{ pattern: GIT, cwdPrefixes: ['/work'], args: [], anyArgs: true }] })).toBe('ENTRY_ARGS');
    expect(refusalOf({ mode: 'allowlist', allowlist: [{ pattern: GIT, cwdPrefixes: ['/work'], anyArgs: false }] })).toBe('ENTRY_ARGS');
    expect(refusalOf({ mode: 'allowlist', allowlist: [{ pattern: GIT, cwdPrefixes: ['/work'], args: [1] }] })).toBe('ENTRY_ARGS');
    expect(refusalOf({ mode: 'allowlist', allowlist: [{ pattern: GIT, cwdPrefixes: ['/work'], anyArgs: true, allowSyntax: ['chaining'] }] })).toBe('ENTRY_SYNTAX');
    expect(refusalOf({ mode: 'allowlist', allowlist: [{ pattern: GIT, cwdPrefixes: ['/work'], anyArgs: true, allowSyntax: ['substitution'] }] })).toBe('ENTRY_SYNTAX');
    expect(refusalOf({ mode: 'allowlist', allowlist: [{ pattern: GIT, cwdPrefixes: ['/work'], anyArgs: true, elevated: true }] })).toBe('ENTRY_SHAPE');
    expect(refusalOf({ mode: 'allowlist', allowlist: Array.from({ length: 65 }, () => GIT_ENTRY) })).toBe('POLICY_ENTRIES');
    expect(refusalOf({ mode: 'allowlist', allowlist: [], dryRun: true })).toBe('POLICY_SHAPE');
    expect(refusalOf(null)).toBe('POLICY_SHAPE');
  });

  it('makes a launch plan only for an allowlist hit in the scope of the binding, and for nothing else', () => {
    const binding = polygo();
    const policy = execPolicy({ mode: 'allowlist', allowlist: [GIT_ENTRY] });
    const clock = movingClock().clock;
    const planned = planAllowlistedExec(binding, policy, unattended, preparedOf(binding), clock);
    expect(planned.ok).toBe(true);
    if (planned.ok) {
      expect(isExecLaunchPlan(planned.plan)).toBe(true);
      expect(planned.plan).toMatchObject({ via: 'allowlist', grantId: null, argv: [GIT, 'status'] });
    }
    expect(planAllowlistedExec(binding, policy, committedRegistry(), preparedOf(binding), clock)).toMatchObject({ ok: false, code: 'NOT_AN_ALLOWLIST_HIT' });
    expect(planAllowlistedExec(binding, policy, unattended, preparedOf(binding, { argv: ['git', 'log'] }), clock)).toMatchObject({ ok: false, code: 'NOT_AN_ALLOWLIST_HIT' });
    expect(planAllowlistedExec(binding, policy, unattended, preparedOf(projectos()), clock)).toMatchObject({ ok: false, code: 'WRONG_SCOPE' });
    expect(planAllowlistedExec({ ...binding }, policy, unattended, preparedOf(binding), clock)).toMatchObject({ ok: false, code: 'NO_TENANT_BINDING' });
  });
});

const click = (change: Record<string, unknown> = {}): Record<string, unknown> => ({
  tool: 'click',
  host: 'app.example.com',
  element: { role: 'button', name: 'Next', type: 'button' },
  initiator: 'person',
  ...change,
});
const READ_ROWS = { rules: [{ id: 'read-pages', effect: 'allow', when: { tools: ['screenshot', 'read-page', 'click'], hosts: ['*.example.com'] } }] };
const classes = registryWith({ 'computer-screenshot': 'P1', 'computer-read-page': 'P1', 'computer-click': 'P2', 'computer-key': 'P2', 'computer-type': 'P2', 'computer-write-file': 'P2', 'computer-run-command': 'P2', 'computer-navigate': 'P1' });

describe('action policy: a typed default-deny table with machine-readable reasons', () => {
  it('allows an action a row names, under a class that runs unattended: the positive control', () => {
    const decision = evaluateActionPolicy(actionPolicy(READ_ROWS), classes, click());
    expect(decision).toMatchObject({ allowed: true, code: 'ALLOW_RULE', matched: 'read-pages', source: 'allow', actionClass: 'P2', ownerRequired: false });
    expect(evaluateActionPolicy(actionPolicy(READ_ROWS), classes, { tool: 'screenshot', host: 'a.example.com', initiator: 'routine' })).toMatchObject({ allowed: true, actionClass: 'P1' });
  });

  it('refuses an action no row allows, with the default as the source', () => {
    const policy = actionPolicy(READ_ROWS);
    expect(evaluateActionPolicy(policy, classes, click({ host: 'evil.test' }))).toMatchObject({ allowed: false, code: 'NO_ALLOW_RULE', source: 'default', matched: null });
    expect(evaluateActionPolicy(policy, classes, { tool: 'navigate', host: 'a.example.com', initiator: 'person' })).toMatchObject({ allowed: false, code: 'NO_ALLOW_RULE' });
    expect(evaluateActionPolicy(actionPolicy({ rules: [] }), classes, click())).toMatchObject({ allowed: false, code: 'NO_ALLOW_RULE' });
  });

  it('refuses when there is no policy, or a policy this module did not compile', () => {
    expect(evaluateActionPolicy(undefined, classes, click())).toMatchObject({ allowed: false, code: 'POLICY_INVALID' });
    expect(evaluateActionPolicy(null, classes, click())).toMatchObject({ allowed: false, code: 'POLICY_INVALID' });
    const handMade = { rules: [{ id: 'all', effect: 'allow', when: { tools: ['click'] } }] } as unknown as ActionPolicy;
    expect(evaluateActionPolicy(handMade, classes, click())).toMatchObject({ allowed: false, code: 'POLICY_INVALID' });
  });

  it('lets a deny row beat an allow row, whatever order they are in', () => {
    const rows = [
      { id: 'allow-clicks', effect: 'allow', when: { tools: ['click'] } },
      { id: 'no-submit', effect: 'deny', when: { elementNameContains: ['submit'] } },
    ];
    for (const rules of [rows, [...rows].reverse()]) {
      const policy = actionPolicy({ rules });
      expect(evaluateActionPolicy(policy, classes, click({ element: { role: 'button', name: 'SUBMIT order', type: 'submit' } }))).toMatchObject({ allowed: false, code: 'DENY_RULE', source: 'deny', matched: 'no-submit' });
      expect(evaluateActionPolicy(policy, classes, click())).toMatchObject({ allowed: true, matched: 'allow-clicks' });
    }
  });

  it('refuses a context that is missing a fact its action needs, instead of reading the missing fact as false', () => {
    const policy = actionPolicy({ rules: [{ id: 'allow-clicks', effect: 'allow', when: { tools: ['click'] } }, { id: 'no-submit', effect: 'deny', when: { elementNameContains: ['submit'] } }] });
    expect(evaluateActionPolicy(policy, classes, { tool: 'click', host: 'a.example.com', initiator: 'person' })).toMatchObject({ allowed: false, code: 'CONTEXT_INCOMPLETE' });
    expect(evaluateActionPolicy(policy, classes, { tool: 'click', element: { role: 'button', name: 'Next' }, initiator: 'person' })).toMatchObject({ code: 'CONTEXT_INCOMPLETE' });
    expect(evaluateActionPolicy(policy, classes, { tool: 'read-file', initiator: 'person' })).toMatchObject({ code: 'CONTEXT_INCOMPLETE' });
    expect(evaluateActionPolicy(policy, classes, { tool: 'run-command', initiator: 'person' })).toMatchObject({ code: 'CONTEXT_INCOMPLETE' });
    expect(evaluateActionPolicy(policy, classes, { tool: 'mcp-write', initiator: 'person' })).toMatchObject({ code: 'CONTEXT_INCOMPLETE' });
  });

  it('derives the intent and refuses a context that states its own, so a rule about activation covers Enter and a submit flag', () => {
    const intent = (raw: Record<string, unknown>): string => {
      const read = readActionContext(raw);
      return read.ok ? read.context.intent : read.code;
    };
    expect(intent(click())).toBe('activate');
    expect(intent({ tool: 'key', host: 'a.example.com', key: 'Enter', initiator: 'person' })).toBe('activate');
    expect(intent({ tool: 'key', host: 'a.example.com', key: ' ', initiator: 'person' })).toBe('activate');
    expect(intent({ tool: 'key', host: 'a.example.com', key: 'a', initiator: 'person' })).toBe('type');
    expect(intent({ tool: 'type', host: 'a.example.com', element: { role: 'textbox', name: 'q' }, submit: true, initiator: 'person' })).toBe('activate');
    expect(intent({ tool: 'type', host: 'a.example.com', element: { role: 'textbox', name: 'q' }, initiator: 'person' })).toBe('type');
    expect(intent(click({ intent: 'read' }))).toBe('CONTEXT_INVALID');
    expect(intent(click({ submit: 'yes' }))).toBe('CONTEXT_INVALID');
    const policy = actionPolicy({ rules: [{ id: 'no-activation', effect: 'deny', when: { intents: ['activate'] } }, { id: 'allow-all-input', effect: 'allow', when: { tools: ['key', 'click', 'type'] } }] });
    expect(evaluateActionPolicy(policy, classes, { tool: 'key', host: 'a.example.com', key: 'enter', initiator: 'person' })).toMatchObject({ code: 'DENY_RULE' });
    expect(evaluateActionPolicy(policy, classes, { tool: 'type', host: 'a.example.com', element: { role: 'textbox', name: 'q' }, submit: true, initiator: 'person' })).toMatchObject({ code: 'DENY_RULE' });
  });

  it('raises a destructive or credential-adjacent action to P5, so an allow row cannot let it through unattended', () => {
    const policy = actionPolicy({ rules: [{ id: 'allow-input', effect: 'allow', when: { tools: ['click', 'type', 'write-file', 'run-command', 'read-file'] } }] });
    const owner = (raw: Record<string, unknown>) => evaluateActionPolicy(policy, classes, raw);
    expect(owner(click({ element: { role: 'button', name: 'Delete account', type: 'button' } }))).toMatchObject({ allowed: false, code: 'OWNER_DECISION_REQUIRED', actionClass: 'P5', floor: 'destructive', ownerRequired: true });
    expect(owner(click({ element: { role: 'button', name: 'Pay now' } }))).toMatchObject({ allowed: false, floor: 'destructive' });
    expect(owner({ tool: 'type', host: 'a.example.com', element: { role: 'textbox', name: 'Search' }, submit: true, initiator: 'person' })).toMatchObject({ allowed: false, floor: 'destructive' });
    expect(owner({ tool: 'type', host: 'a.example.com', element: { role: 'textbox', name: 'Email', type: 'password' }, initiator: 'person' })).toMatchObject({ allowed: false, floor: 'credential-adjacent', actionClass: 'P5' });
    expect(owner({ tool: 'type', host: 'a.example.com', element: { role: 'textbox', name: 'One-time code (OTP)' }, initiator: 'person' })).toMatchObject({ allowed: false, floor: 'credential-adjacent' });
    expect(owner({ tool: 'read-file', file: { path: '.env' }, initiator: 'agent' })).toMatchObject({ allowed: false, floor: 'credential-adjacent' });
    expect(owner({ tool: 'read-file', file: { path: 'docs/.SSH/id_rsa' }, initiator: 'agent' })).toMatchObject({ allowed: false, floor: 'credential-adjacent' });
    expect(owner({ tool: 'write-file', file: { path: 'notes/a.md' }, initiator: 'agent' })).toMatchObject({ allowed: false, floor: 'destructive', actionClass: 'P5' });
    expect(owner({ tool: 'run-command', exec: preparedOf(polygo(), { argv: ['ls'] }), initiator: 'agent' })).toMatchObject({ allowed: false, floor: 'destructive' });
    expect(owner({ tool: 'read-file', file: { path: 'docs/readme.md' }, initiator: 'agent' })).toMatchObject({ allowed: false, code: 'OWNER_DECISION_REQUIRED', floor: null });
  });

  it('reads the class from the registry: every action is P5 until the registry lists it, and P6 is never allowed', () => {
    const policy = actionPolicy(READ_ROWS);
    expect(evaluateActionPolicy(policy, committedRegistry(), click())).toMatchObject({ allowed: false, code: 'OWNER_DECISION_REQUIRED', actionClass: 'P5', ownerRequired: true });
    expect(evaluateActionPolicy(policy, registryWith({ 'computer-click': 'P6' }), click())).toMatchObject({ allowed: false, code: 'CLASS_PROHIBITED', actionClass: 'P6' });
    expect(evaluateActionPolicy(policy, registryWith({ 'computer-click': 'P4' }), click())).toMatchObject({ allowed: false, code: 'OWNER_DECISION_REQUIRED', actionClass: 'P4' });
  });

  it('refuses a whole policy for one row it cannot read completely, with the row named by code', () => {
    const code = (rules: unknown): string => {
      const result = compileActionPolicy({ rules });
      return result.ok ? 'ok' : result.code;
    };
    expect(code([{ id: 'a-row', effect: 'allow', when: { tools: ['click'] } }])).toBe('ok');
    expect(code([{ id: 'a-row', effect: 'allow', when: {} }])).toBe('ALLOW_NEEDS_TOOL_OR_INTENT');
    expect(code([{ id: 'a-row', effect: 'allow', when: { hosts: ['a.example.com'] } }])).toBe('ALLOW_NEEDS_TOOL_OR_INTENT');
    expect(code([{ id: 'a-row', effect: 'deny', when: {} }])).toBe('ok');
    expect(code([{ id: 'a-row', effect: 'maybe', when: { tools: ['click'] } }])).toBe('RULE_EFFECT');
    expect(code([{ id: 'A Row', effect: 'deny', when: {} }])).toBe('RULE_ID');
    expect(code([{ id: 'a-row', effect: 'deny', when: {} }, { id: 'a-row', effect: 'deny', when: {} }])).toBe('RULE_ID');
    expect(code([{ id: 'a-row', effect: 'deny', when: { tools: ['teleport'] } }])).toBe('RULE_CONDITION');
    expect(code([{ id: 'a-row', effect: 'deny', when: { tools: [] } }])).toBe('RULE_CONDITION');
    expect(code([{ id: 'a-row', effect: 'deny', when: { hosts: ['10.0.0.1'] } }])).toBe('RULE_CONDITION');
    expect(code([{ id: 'a-row', effect: 'deny', when: { hosts: ['*'] } }])).toBe('RULE_CONDITION');
    expect(code([{ id: 'a-row', effect: 'deny', when: { filePathPrefixes: ['../etc'] } }])).toBe('RULE_CONDITION');
    expect(code([{ id: 'a-row', effect: 'deny', when: { expression: 'true' } }])).toBe('RULE_CONDITION');
    expect(code([{ id: 'a-row', effect: 'deny', when: { tools: ['click'] }, mode: 'dry-run' }])).toBe('RULE_SHAPE');
    expect(code(Array.from({ length: 65 }, (_, index) => ({ id: `row-${index}`, effect: 'deny', when: {} })))).toBe('POLICY_RULES');
    expect(compileActionPolicy({ rules: [], mode: 'dry-run' })).toMatchObject({ ok: false, code: 'POLICY_SHAPE' });
    expect(compileActionPolicy('rules')).toMatchObject({ ok: false, code: 'POLICY_SHAPE' });
  });

  it('matches hosts, files, keys, MCP effects and initiators, each by its own condition', () => {
    const policy = actionPolicy({
      rules: [
        { id: 'no-env-files', effect: 'deny', when: { fileExtensions: ['env'] } },
        { id: 'no-secrets-dir', effect: 'deny', when: { filePathPrefixes: ['secrets/'] } },
        { id: 'no-mcp-writes', effect: 'deny', when: { mcpEffects: ['write'], mcpServers: ['jira'] } },
        { id: 'no-routine-shell', effect: 'deny', when: { tools: ['run-command'], initiators: ['routine'] } },
        { id: 'allow-everything-useful', effect: 'allow', when: { tools: ['read-file', 'mcp-read', 'mcp-write', 'run-command', 'key'] } },
      ],
    });
    const decide = (raw: Record<string, unknown>) => evaluateActionPolicy(policy, classes, raw);
    expect(decide({ tool: 'read-file', file: { path: 'config/.env' }, initiator: 'agent' })).toMatchObject({ matched: 'no-env-files' });
    expect(decide({ tool: 'read-file', file: { path: 'Secrets/a.txt' }, initiator: 'agent' })).toMatchObject({ matched: 'no-secrets-dir' });
    expect(decide({ tool: 'mcp-write', mcp: { server: 'Jira', tool: 'editIssue', effect: 'write' }, initiator: 'agent' })).toMatchObject({ matched: 'no-mcp-writes' });
    expect(decide({ tool: 'mcp-write', mcp: { server: 'notes', tool: 'edit', effect: 'write' }, initiator: 'agent' }).matched).toBe('allow-everything-useful');
    expect(decide({ tool: 'run-command', exec: preparedOf(polygo(), { argv: ['ls'] }), initiator: 'routine' })).toMatchObject({ matched: 'no-routine-shell' });
    expect(decide({ tool: 'run-command', exec: preparedOf(polygo(), { argv: ['ls'] }), initiator: 'person' }).matched).toBe('allow-everything-useful');
  });

  it('refuses an unbounded or unreadable fact: an escaping file path, a host that is an address, a control character', () => {
    const code = (raw: Record<string, unknown>): string => {
      const read = readActionContext(raw);
      return read.ok ? 'ok' : read.code;
    };
    expect(code({ tool: 'read-file', file: { path: '../../etc/passwd' }, initiator: 'agent' })).toBe('CONTEXT_INVALID');
    expect(code({ tool: 'read-file', file: { path: '/etc/passwd' }, initiator: 'agent' })).toBe('CONTEXT_INVALID');
    expect(code({ tool: 'read-file', file: { path: 'a\\b' }, initiator: 'agent' })).toBe('CONTEXT_INVALID');
    expect(code({ tool: 'read-file', file: { path: 'notes.txt.' }, initiator: 'agent' })).toBe('CONTEXT_INVALID');
    expect(code({ tool: 'read-file', file: { path: 'a/./b.txt', extra: 1 }, initiator: 'agent' })).toBe('CONTEXT_INVALID');
    expect(code({ tool: 'navigate', host: '169.254.169.254', initiator: 'agent' })).toBe('CONTEXT_INVALID');
    expect(code({ tool: 'navigate', host: 'a b', initiator: 'agent' })).toBe('CONTEXT_INVALID');
    expect(code({ tool: 'click', host: 'a.example.com', element: { role: 'button', name: 'x\u0000y' }, initiator: 'person' })).toBe('CONTEXT_INVALID');
    expect(code({ tool: 'teleport', initiator: 'person' })).toBe('CONTEXT_INVALID');
    expect(code({ tool: 'screenshot', host: 'a.example.com', initiator: 'somebody' })).toBe('CONTEXT_INVALID');
    expect(code({ tool: 'screenshot', host: 'a.example.com.', initiator: 'person' })).toBe('ok');
  });
});

const row = (change: Partial<NetworkPolicyRow> = {}): NetworkPolicyRow => ({
  tenant: 'owner-personal',
  project: 'polygo',
  scopeKind: 'organization',
  scopeId: 'org',
  mode: 'allowlist_only',
  rules: [{ host: 'api.example.com' }, { host: '*.docs.example.com' }],
  locked: false,
  ...change,
});

describe('network policy: no row is no network, and there is no allow-all', () => {
  const binding = polygo();
  const effective = (rows: readonly NetworkPolicyRow[], groups: readonly string[] = [], capability = true) => effectiveNetworkPolicy(binding, rows, { groups }, capability);

  it('allows the hosts an organization row lists, and nothing else: the positive control', () => {
    const policy = effective([row()]);
    expect(policy).toMatchObject({ mode: 'allowlist_only', from: 'organization' });
    expect(egressAllowed(policy, 'api.example.com')).toBe(true);
    expect(egressAllowed(policy, 'API.Example.com')).toBe(false);
    expect(egressAllowed(policy, 'x.docs.example.com')).toBe(true);
    expect(egressAllowed(policy, 'docs.example.com')).toBe(false);
    expect(egressAllowed(policy, 'evil.example.org')).toBe(false);
    expect(egressAllowed(policy, 'api.example.com.evil.test')).toBe(false);
  });

  it('denies all when there is no row at all, where the source left the computer open', () => {
    const policy = effective([]);
    expect(policy).toMatchObject({ mode: 'deny_all', from: 'none' });
    expect(egressAllowed(policy, 'api.example.com')).toBe(false);
  });

  it('denies all when the capability is off, whatever the rows say, and for a binding that was not derived', () => {
    expect(effective([row()], [], false)).toMatchObject({ mode: 'deny_all', from: 'capability' });
    expect(effective([row()], [], 'yes' as unknown as boolean)).toMatchObject({ mode: 'deny_all', from: 'capability' });
    expect(effectiveNetworkPolicy({ ...binding }, [row()], { groups: [] }, true)).toMatchObject({ mode: 'deny_all', from: 'no-binding' });
  });

  it('never lets a group row widen the organization row: every applying row must allow the host', () => {
    const group = row({ scopeKind: 'group', scopeId: 'ops', rules: [{ host: 'ops.example.com' }, { host: 'api.example.com' }] });
    const policy = effective([row(), group], ['ops']);
    expect(policy).toMatchObject({ mode: 'allowlist_only', from: 'group:ops+organization' });
    expect(egressAllowed(policy, 'api.example.com')).toBe(true);
    expect(egressAllowed(policy, 'ops.example.com')).toBe(false);
    expect(effective([row({ locked: true }), group], ['ops'])).toMatchObject({ from: 'group:ops+organization' });
    expect(effective([row(), group], ['other'])).toMatchObject({ from: 'organization' });
  });

  it('answers the same whatever the order or the names of the groups that apply', () => {
    const a = row({ scopeKind: 'group', scopeId: 'a-team', rules: [{ host: 'api.example.com' }] });
    const b = row({ scopeKind: 'group', scopeId: 'b-team', rules: [{ host: 'api.example.com' }, { host: 'b.example.com' }] });
    expect(effective([b, a], ['a-team', 'b-team'])).toMatchObject({ from: 'group:a-team+group:b-team' });
    expect(effective([a, b], ['a-team', 'b-team'])).toMatchObject({ from: 'group:a-team+group:b-team' });
    expect(egressAllowed(effective([b, a], ['a-team', 'b-team']), 'b.example.com')).toBe(false);
    expect(egressAllowed(effective([a, b], ['a-team', 'b-team']), 'b.example.com')).toBe(false);
  });

  it('refuses a row that does not read, or asks for allow all, and denies instead of half applying it', () => {
    expect(effective([row({ mode: 'allow_all' })])).toMatchObject({ mode: 'deny_all', from: 'organization:refused' });
    expect(effective([row({ mode: 'deny_all' })])).toMatchObject({ mode: 'deny_all' });
    for (const rules of [[{ host: '10.0.0.1' }], [{ host: '*' }], [{ host: 'a b' }], [{ host: 'localhost', extra: 1 }], 'a.example.com', [{ host: 7 }]]) {
      expect(effective([row({ rules })]), JSON.stringify(rules)).toMatchObject({ mode: 'deny_all', from: 'organization:refused' });
    }
  });

  it('refuses the whole answer when a row belongs to another tenant or project', () => {
    expect(effective([row(), row({ project: 'projectos', scopeKind: 'group', scopeId: 'ops' })], ['ops'])).toMatchObject({ mode: 'deny_all', from: 'row-of-another-scope' });
    expect(effective([row({ tenant: 'agency-business' })])).toMatchObject({ mode: 'deny_all', from: 'row-of-another-scope' });
  });

  it('never allows an address, a host it cannot read, or a policy it did not make', () => {
    const policy = effective([row({ rules: [{ host: 'api.example.com' }] })]);
    for (const host of ['127.0.0.1', '169.254.169.254', '[::1]', 'api.example.com:8080', 'api.example.com/x', '', undefined, 7]) expect(egressAllowed(policy, host), String(host)).toBe(false);
    expect(egressAllowed({ mode: 'allowlist_only', rules: ['api.example.com'], from: 'made-up' }, 'api.example.com')).toBe(false);
    expect(egressAllowed(null as never, 'api.example.com')).toBe(false);
  });
});
