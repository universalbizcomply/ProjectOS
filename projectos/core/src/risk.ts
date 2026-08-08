/**
 * Risk engine: classify an action string against the eight canonical safety gates.
 *
 * The default gate set mirrors schemas/safety-gates.schema.json. Classification is a
 * deterministic keyword map — deliberately conservative: unknown actions are 'low' and
 * ungated, known dangerous actions map to their gate and a high/critical risk level.
 */
import type { GateKey, RiskLevel, SafetyGate } from './types.js';

export const DEFAULT_SAFETY_GATES: Readonly<Record<GateKey, SafetyGate>> = {
  productionDeployGate: {
    status: 'gated',
    requiresOwnerApproval: true,
    description: 'Production deploy.',
  },
  productionDbMutationGate: {
    status: 'gated',
    requiresOwnerApproval: true,
    description: 'Production database mutation.',
  },
  realMessagingGate: {
    status: 'gated',
    requiresOwnerApproval: true,
    description: 'Real email / SMS / WhatsApp send.',
  },
  paymentGate: {
    status: 'gated',
    requiresOwnerApproval: true,
    description: 'Payment / live charge / refund.',
  },
  secretsHandlingGate: {
    status: 'gated',
    requiresOwnerApproval: true,
    description: 'Secrets handling.',
  },
  forcePushProhibition: {
    status: 'prohibited',
    requiresOwnerApproval: true,
    description: 'Force push is prohibited unless the owner explicitly overrides.',
  },
  externalServiceGate: {
    status: 'gated',
    requiresOwnerApproval: true,
    description: 'Any external service / API call.',
  },
  closureAuthorityGate: {
    status: 'gated',
    requiresOwnerApproval: true,
    description: 'Only Murad/ChatGPT may close a phase.',
  },
};

/** Keyword patterns that map an action onto a gate. First match wins.
 *
 * EXPORTED so the test suite can assert that EVERY `GateKey` has a pattern: this table is a plain
 * array, so TypeScript gives it no exhaustiveness check, and a gate defined without a pattern here
 * silently classifies as low/ungated (see `closureAuthorityGate`). */
export const GATE_PATTERNS: ReadonlyArray<{ readonly gate: GateKey; readonly patterns: readonly RegExp[] }> = [
  { gate: 'forcePushProhibition', patterns: [/force\s*-?push/i, /push\s+--force/i, /\bpush\s+-f\b/i] },
  { gate: 'productionDeployGate', patterns: [/prod(uction)?\s*deploy/i, /deploy\s*(to\s*)?prod/i, /production\s*cutover/i] },
  { gate: 'productionDbMutationGate', patterns: [/prod(uction)?\s*(db|database)/i, /drop\s+table/i, /truncate/i, /delete\s+from/i, /production.*migrat/i] },
  { gate: 'paymentGate', patterns: [/payment/i, /\bcharge\b/i, /refund/i, /invoice.*(pay|capture)/i] },
  { gate: 'realMessagingGate', patterns: [/send.*(email|sms|whatsapp|message)/i, /\bemail\s+send/i, /\bsms\b/i, /whatsapp/i] },
  { gate: 'secretsHandlingGate', patterns: [/secret/i, /api[_\s-]?key/i, /access[_\s-]?token/i, /service[_\s-]?role/i, /\bcredential/i] },
  { gate: 'externalServiceGate', patterns: [/external\s+(service|api)/i, /third[-\s]?party\s+api/i, /call\s+.*\bapi\b/i] },
  // Closure is owner-gated by `transitionPhase` (OWNER_ONLY_TARGETS), but an APPROVAL RECORD for a
  // closure action was classifying as low/ungated because this gate had no pattern — so an
  // implementer could self-decide it. Found by PROJECTOS-V3-FINAL-RUNTIME-E2E1A.
  //
  // The verb form must include the PAST TENSE (`closed`): `\bclos(e|ing|ure)\b` cannot match
  // "closed", because the `\b` after `e` fails against the following `d` — so "mark phase X as
  // closed" would have slipped through ungated. The first pattern also requires `phase` to be the
  // DIRECT OBJECT (optionally articled), so ordinary work such as "close a GitHub issue in this
  // phase" or "close the file handle during this phase" stays ungated instead of being swept in.
  {
    gate: 'closureAuthorityGate',
    patterns: [
      /\bclos(e|ed|ing|ure\s+of)\s+(?:the\s+|this\s+|a\s+)?phase\b/i,
      /\bphase\b[^.]{0,40}?\bclos(ed|ing|ure)\b/i,
    ],
  },
];

/** Risk level assigned per gate when matched. */
const GATE_RISK: Readonly<Record<GateKey, RiskLevel>> = {
  productionDeployGate: 'critical',
  productionDbMutationGate: 'critical',
  paymentGate: 'critical',
  realMessagingGate: 'high',
  secretsHandlingGate: 'high',
  forcePushProhibition: 'critical',
  externalServiceGate: 'medium',
  closureAuthorityGate: 'high',
};

export interface RiskClassification {
  readonly action: string;
  readonly gate?: GateKey;
  readonly risk: RiskLevel;
  readonly gated: boolean;
  readonly prohibited: boolean;
}

/**
 * Classify an arbitrary action string. Optionally supply a gate set (defaults to the
 * canonical one) so projects can tighten but never silently loosen gates.
 */
export function classifyAction(
  action: string,
  gates: Readonly<Record<GateKey, SafetyGate>> = DEFAULT_SAFETY_GATES,
): RiskClassification {
  for (const { gate, patterns } of GATE_PATTERNS) {
    if (patterns.some((p) => p.test(action))) {
      const def = gates[gate];
      return {
        action,
        gate,
        risk: GATE_RISK[gate],
        gated: def.requiresOwnerApproval || def.status === 'gated',
        prohibited: def.status === 'prohibited',
      };
    }
  }
  return { action, risk: 'low', gated: false, prohibited: false };
}

export function isGatedAction(action: string): boolean {
  return classifyAction(action).gated;
}
