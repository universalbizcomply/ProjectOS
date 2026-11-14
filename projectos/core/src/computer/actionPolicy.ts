// SPDX-License-Identifier: MIT
// Ported-From: copilotkit-openbot https://github.com/CopilotKit/OpenBot
// Source-Path: server/src/computer/policy.ts
// Source-Commit: c396a5f68c817043846f1ca3c2b42061ee73ceb5
// Source-Copyright: Copyright (c) 2026 CopilotKit
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the decision model is taken, default deny, a deny list that is read before the allow list and beats it, and a policy that cannot be read refusing every action; the rules are a typed table of conditions instead of CEL expressions, so no expression language and no dependency is needed and a rule cannot be a string that is true by accident; the dry-run mode that lets everything through, the enterprise overlay hook, the console logging, the rule labels and the refusal prose are cut; an allow row must name a tool or an intent, an allow can never reach a class above P3, and P6 is never allowed; every decision carries a machine-readable reason code and the class looked up in the action registry
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Whether a computer action may be taken: a typed, default-deny table.
 *
 * THE DEFAULT IS NO. An absent policy, a policy this module did not compile, a context it cannot read and an action no allow
 * row covers are all refusals, each with a machine-readable code. A deny row beats every allow row. There is no dry-run mode
 * that decides and then lets the action through, and no mode that is off: the only modes are decided and refused.
 *
 * A TABLE, NOT AN EXPRESSION. A row is a set of conditions (tool, intent, host, element role or name, key, file extension or
 * path prefix, MCP server or effect, initiator, a word in the command), every present condition must hold, and each holds
 * if ANY of its listed values matches. A row with an unknown field, an unknown value, a pattern it cannot read completely or
 * no condition at all as an allow row is refused, and one bad row refuses the whole policy so a bad line never leaves good
 * lines in force.
 *
 * THE CLASS IS LOOKED UP, NEVER SAID. Each tool is the registry action `computer-<tool>` and its class is the registry's (R5:
 * unregistered is P5). A destructive or credential-adjacent action is raised to P5 here, in code, whatever the registry says.
 * A row can allow only what runs unattended, class P3 or below: a P5 action is `OWNER_DECISION_REQUIRED` even when a row
 * allows it, and P6 is never allowed. Until the registry lists the `computer-*` actions every action reads as P5, so every
 * allow row refuses, which is the safe default and the reason nothing here is switched on.
 *
 * WHAT THIS MODULE CANNOT PROVE. That a context's element, host and file are what the page and the disk really hold is the
 * caller's: the server must resolve them itself and never take them from the model. That the policy in force is the one the
 * owner wrote is the caller's too.
 *
 * Pure: no I/O.
 */
import { classAtMost, resolveAction, type ActionClass, type ActionRegistry } from '../actionRegistry.js';
import {
  COMPUTER_INTENTS,
  COMPUTER_TOOLS,
  INITIATOR_KINDS,
  foldedText,
  isAddressLikeHost,
  normalizeKey,
  readActionContext,
  type ComputerActionContext,
} from './actionContext.js';
import { snapshotOfArray, snapshotOfFields } from './plainFields.js';

export const MAX_POLICY_RULES = 64;
export const MAX_CONDITION_VALUES = 32;
export const UNATTENDED_ACTION_CLASS: ActionClass = 'P3';
export const COMPUTER_ACTION_PREFIX = 'computer-';

const WHEN_FIELDS = ['tools', 'intents', 'hosts', 'elementRoles', 'elementNameContains', 'keys', 'fileExtensions', 'filePathPrefixes', 'mcpServers', 'mcpEffects', 'initiators', 'commandContains'] as const;
type WhenField = (typeof WHEN_FIELDS)[number];
export type ActionRuleWhen = Partial<Record<WhenField, readonly string[]>>;

export interface ActionRule {
  readonly id: string;
  readonly effect: 'allow' | 'deny';
  readonly when: ActionRuleWhen;
}

export interface ActionPolicy {
  readonly rules: readonly ActionRule[];
}

export type ActionPolicyRefusal = 'POLICY_SHAPE' | 'POLICY_RULES' | 'RULE_SHAPE' | 'RULE_ID' | 'RULE_EFFECT' | 'RULE_CONDITION' | 'ALLOW_NEEDS_TOOL_OR_INTENT';
export type ActionPolicyResult = { readonly ok: true; readonly policy: ActionPolicy } | { readonly ok: false; readonly code: ActionPolicyRefusal; readonly detail: string };

const COMPILED = new WeakSet<object>();
const RULE_ID = /^[a-z][a-z0-9-]{1,47}$/;
const HOST_PATTERN = /^(?:\*\.)?(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EXTENSION = /^[a-z0-9]{1,16}$/;
const PREFIX = /^[a-z0-9._-]+(?:\/[a-z0-9._-]+)*\/?$/;
const fail = (code: ActionPolicyRefusal, detail: string): ActionPolicyResult => ({ ok: false, code, detail });

/** Whether every value of a condition is one this module reads completely. */
function valuesFit(field: WhenField, values: readonly string[]): boolean {
  switch (field) {
    case 'tools':
      return values.every((value) => (COMPUTER_TOOLS as readonly string[]).includes(value));
    case 'intents':
      return values.every((value) => (COMPUTER_INTENTS as readonly string[]).includes(value));
    case 'initiators':
      return values.every((value) => (INITIATOR_KINDS as readonly string[]).includes(value));
    case 'mcpEffects':
      return values.every((value) => value === 'read' || value === 'write');
    case 'hosts':
      return values.every((value) => HOST_PATTERN.test(value) && !isAddressLikeHost(value));
    case 'keys':
      return values.every((value) => normalizeKey(value)?.key === value && !value.includes('+'));
    case 'fileExtensions':
      return values.every((value) => EXTENSION.test(value));
    case 'filePathPrefixes':
      return values.every((value) => PREFIX.test(value) && !value.split('/').includes('..'));
    default:
      return values.every((value) => foldedText(value, 128) === value && value !== '');
  }
}

function whenOf(raw: unknown): { readonly ok: true; readonly when: ActionRuleWhen } | { readonly ok: false } {
  const fields = snapshotOfFields(raw, WHEN_FIELDS);
  if (fields === null) return { ok: false };
  const when: Partial<Record<WhenField, readonly string[]>> = {};
  for (const field of WHEN_FIELDS) {
    if (fields[field] === undefined) continue;
    const values = snapshotOfArray(fields[field], MAX_CONDITION_VALUES);
    if (values === null || values.length === 0 || values.some((value) => typeof value !== 'string') || !valuesFit(field, values as readonly string[])) return { ok: false };
    when[field] = Object.freeze([...(values as readonly string[])]);
  }
  return { ok: true, when: Object.freeze(when) };
}

function ruleOf(raw: unknown, index: number): { readonly ok: true; readonly rule: ActionRule } | { readonly ok: false; readonly result: ActionPolicyResult } {
  const label = `rules[${index}]`;
  const fields = snapshotOfFields(raw, ['id', 'effect', 'when']);
  if (fields === null) return { ok: false, result: fail('RULE_SHAPE', `${label} is a plain object of id, effect and when`) };
  if (typeof fields['id'] !== 'string' || !RULE_ID.test(fields['id'])) return { ok: false, result: fail('RULE_ID', `${label} has no plain id`) };
  if (fields['effect'] !== 'allow' && fields['effect'] !== 'deny') return { ok: false, result: fail('RULE_EFFECT', `${label} is allow or deny`) };
  const when = whenOf(fields['when'] ?? {});
  if (!when.ok) return { ok: false, result: fail('RULE_CONDITION', `${label} has a condition this module cannot read completely`) };
  if (fields['effect'] === 'allow' && when.when.tools === undefined && when.when.intents === undefined) {
    return { ok: false, result: fail('ALLOW_NEEDS_TOOL_OR_INTENT', `${label} allows without naming a tool or an intent`) };
  }
  return { ok: true, rule: Object.freeze({ id: fields['id'], effect: fields['effect'], when: when.when }) };
}

/** Read a policy once. One bad rule refuses the whole of it. */
export function compileActionPolicy(raw: unknown): ActionPolicyResult {
  const fields = snapshotOfFields(raw, ['rules']);
  const list = fields === null ? null : snapshotOfArray(fields['rules'], MAX_POLICY_RULES);
  if (fields === null) return fail('POLICY_SHAPE', 'a policy is a plain object with rules');
  if (list === null) return fail('POLICY_RULES', `rules is a plain array of at most ${MAX_POLICY_RULES}`);
  const rules: ActionRule[] = [];
  for (const [index, item] of list.entries()) {
    const read = ruleOf(item, index);
    if (!read.ok) return read.result;
    if (rules.some((rule) => rule.id === read.rule.id)) return fail('RULE_ID', `the rule id '${read.rule.id}' is used twice`);
    rules.push(read.rule);
  }
  const policy: ActionPolicy = Object.freeze({ rules: Object.freeze(rules) });
  COMPILED.add(policy);
  return { ok: true, policy };
}

const DESTRUCTIVE_TOOLS: readonly string[] = ['write-file', 'download-file', 'run-command', 'mcp-write'];
/** Words that make an activation destructive: spending, sending, removing, publishing or leaving. Matched on folded text, at word edges. */
const DESTRUCTIVE_WORDS = new RegExp(
  '(?:^|[^a-z0-9])(?:' +
    [
      'place\\s+order', 'buy', 'purchase', 'pay', 'payment', 'approve\\s+payment', 'authori[sz]e', 'revoke', 'sign\\s*-?\\s*out', 'log\\s*-?\\s*out', 'transfer', 'send\\s+money',
      'delete', 'remove', 'erase', 'wipe', 'format', 'reset', 'uninstall', 'publish', 'submit', 'confirm', 'send', 'post', 'checkout', 'withdraw', 'wire', 'unsubscribe', 'deactivate',
    ].join('|') +
    ')(?:$|[^a-z0-9])',
);
const CREDENTIAL_WORDS = /pass(?:word|code|wd)|\botp\b|totp|2fa|mfa|secret|token|api[ _-]?key|card number|\bcvv\b|\bssn\b|credential|private key/;
/** Paths that hold a secret, on a lower-case workspace path: a directory, a file name or an extension. */
const CREDENTIAL_PATHS = [
  /(?:^|\/)\.(?:ssh|aws|gnupg|kube)(?:\/|$)/,
  /(?:^|\/)\.docker\/config\.json$/,
  /(?:^|\/)\.(?:git-credentials|pypirc|npmrc|netrc|pgpass)$/,
  /\.(?:pem|key|p12|pfx|kdbx|env)$/,
  /(?:^|\/)\.env[^/]*$/,
  /(?:^|\/)id_(?:rsa|ed25519|ecdsa|dsa)[^/]*$/,
  /(?:^|\/)terraform\.tfstate[^/]*$/,
  /(?:^|\/)credentials[^/]*$/,
  /(?:^|\/)(?:secrets?|tokens?)(?:\/|$)/,
];
const isCredentialPath = (path: string): boolean => CREDENTIAL_PATHS.some((pattern) => pattern.test(path));

/** Why this action is raised to P5 whatever the registry says, or `null`. */
export function floorReason(context: ComputerActionContext): 'destructive' | 'credential-adjacent' | null {
  const element = context.element;
  const texts = [context.title, context.url, ...(element === null ? [] : [element.name, element.role, element.label])];
  if (element !== null && element.type === 'password') return 'credential-adjacent';
  if (texts.some((text) => CREDENTIAL_WORDS.test(text))) return 'credential-adjacent';
  if (context.file !== null && (isCredentialPath(context.file.path) || CREDENTIAL_WORDS.test(context.file.name))) return 'credential-adjacent';
  if (context.command !== null && CREDENTIAL_WORDS.test(context.command)) return 'credential-adjacent';
  if (DESTRUCTIVE_TOOLS.includes(context.tool) || context.submit || context.textActivates || context.keyDestructive || (context.mcp !== null && context.mcp.effect === 'write')) return 'destructive';
  if (context.intent === 'activate' && (context.tool === 'key' || texts.some((text) => DESTRUCTIVE_WORDS.test(text)))) return 'destructive';
  return null;
}

/** The class of an action: the registry's, raised to P5 for a destructive or credential-adjacent action. */
export function classOfComputerAction(registry: ActionRegistry, context: ComputerActionContext): ActionClass {
  const registered = resolveAction(registry, `${COMPUTER_ACTION_PREFIX}${context.tool}`).actionClass;
  return floorReason(context) !== null && classAtMost(registered, 'P5') ? 'P5' : registered;
}

/** A path is under a prefix by whole segments: `docs` covers `docs` and `docs/a`, never `docs-private/a`. */
const underPrefix = (path: string, prefix: string): boolean => {
  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return path === base || path.startsWith(`${base}/`);
};
const folds = (values: readonly string[], text: string): boolean => values.some((value) => text.includes(value));
const hostMatches = (patterns: readonly string[], host: string | null): boolean =>
  host !== null && patterns.some((pattern) => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1 : host === pattern));

/** Whether every present condition of a row holds for this context. */
function covers(when: ActionRuleWhen, context: ComputerActionContext): boolean {
  const checks: readonly (readonly [WhenField, (values: readonly string[]) => boolean])[] = [
    ['tools', (values) => values.includes(context.tool)],
    ['intents', (values) => values.includes(context.intent)],
    ['hosts', (values) => hostMatches(values, context.host)],
    ['elementRoles', (values) => context.element !== null && values.includes(context.element.role)],
    ['elementNameContains', (values) => context.element !== null && folds(values, context.element.name)],
    ['keys', (values) => context.key !== null && values.includes(context.key)],
    ['fileExtensions', (values) => context.file !== null && values.includes(context.file.extension)],
    ['filePathPrefixes', (values) => context.file !== null && values.some((prefix) => underPrefix(context.file?.path ?? '', prefix))],
    ['mcpServers', (values) => context.mcp !== null && values.includes(context.mcp.server)],
    ['mcpEffects', (values) => context.mcp !== null && values.includes(context.mcp.effect)],
    ['initiators', (values) => values.includes(context.initiator)],
    ['commandContains', (values) => context.command !== null && folds(values, context.command)],
  ];
  return checks.every(([field, holds]) => when[field] === undefined || holds(when[field] as readonly string[]));
}

export type ActionDecisionCode =
  | 'POLICY_INVALID'
  | 'CONTEXT_INVALID'
  | 'CONTEXT_INCOMPLETE'
  | 'DENY_RULE'
  | 'NO_ALLOW_RULE'
  | 'CLASS_PROHIBITED'
  | 'OWNER_DECISION_REQUIRED'
  | 'ALLOW_RULE';

export interface ActionDecision {
  readonly allowed: boolean;
  readonly code: ActionDecisionCode;
  /** The id of the row that decided it, or `null` for a default refusal. */
  readonly matched: string | null;
  readonly source: 'deny' | 'allow' | 'default';
  readonly actionClass: ActionClass | null;
  readonly floor: 'destructive' | 'credential-adjacent' | null;
  readonly ownerRequired: boolean;
  readonly detail: string | null;
}

const decided = (allowed: boolean, code: ActionDecisionCode, source: ActionDecision['source'], matched: string | null, extra: Partial<ActionDecision> = {}): ActionDecision =>
  Object.freeze({ allowed, code, matched, source, actionClass: null, floor: null, ownerRequired: false, detail: null, ...extra });

/** Decide one action. A refusal is the default, and every answer says which rule or which fact decided it. */
export function evaluateActionPolicy(policy: ActionPolicy | null | undefined, registry: ActionRegistry, rawContext: unknown): ActionDecision {
  if (typeof policy !== 'object' || policy === null || !COMPILED.has(policy)) return decided(false, 'POLICY_INVALID', 'default', null);
  const read = readActionContext(rawContext);
  if (!read.ok) return decided(false, read.code, 'default', null, { detail: read.detail });
  const context = read.context;
  const actionClass = classOfComputerAction(registry, context);
  const floor = floorReason(context);
  const base = { actionClass, floor };
  const deny = policy.rules.find((rule) => rule.effect === 'deny' && covers(rule.when, context));
  if (deny !== undefined) return decided(false, 'DENY_RULE', 'deny', deny.id, base);
  const allow = policy.rules.find((rule) => rule.effect === 'allow' && covers(rule.when, context));
  if (allow === undefined) return decided(false, 'NO_ALLOW_RULE', 'default', null, base);
  if (actionClass === 'P6') return decided(false, 'CLASS_PROHIBITED', 'allow', allow.id, base);
  if (!classAtMost(actionClass, UNATTENDED_ACTION_CLASS)) return decided(false, 'OWNER_DECISION_REQUIRED', 'allow', allow.id, { ...base, ownerRequired: true });
  return decided(true, 'ALLOW_RULE', 'allow', allow.id, base);
}
