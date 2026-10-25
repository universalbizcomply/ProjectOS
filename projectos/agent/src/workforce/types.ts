/**
 * Types of the governed workforce (PROJECTOS-AGENT-WORKFORCE1A).
 *
 * THE OPERATING MODEL. Owner, then ProjectOS governance, then exactly one project leader per
 * governed project, then the specialists ProjectOS selects, then execution engines, then evidence,
 * then ProjectOS gates, then the owner wherever protected authority is required.
 *
 * FOUR GOVERNANCE-OWNED DOCUMENTS decide everything the workforce may do: the workforce
 * configuration, the registry (whose `eligibility` is the registry eligibility), the selection policy
 * and the model policy. ProjectOS reads them only from the owner-accepted committed state
 * (`governance.ts`); the leader and the specialists can change none of them.
 */

export type TaskType = 'bug-fix' | 'security-sensitive-change' | 'ui-change' | 'multi-system-feature';
export const TASK_TYPES: readonly TaskType[] = ['bug-fix', 'security-sensitive-change', 'ui-change', 'multi-system-feature'];

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'];

/** A declared risk fact. The first six are PROTECTED facts: a failed task carrying one escalates. */
export type RiskFact =
  | 'security'
  | 'data'
  | 'payment'
  | 'production'
  | 'credential'
  | 'communication'
  | 'auth'
  | 'ui'
  | 'accessibility'
  | 'multi-system';
export const RISK_FACTS: readonly RiskFact[] = [
  'security',
  'data',
  'payment',
  'production',
  'credential',
  'communication',
  'auth',
  'ui',
  'accessibility',
  'multi-system',
];
export const PROTECTED_FACTS: readonly RiskFact[] = ['security', 'data', 'payment', 'production', 'credential', 'communication', 'auth'];

export type CostClass = 'low' | 'standard' | 'high';
export const COST_CLASSES: readonly CostClass[] = ['low', 'standard', 'high'];

export type RiskTier = 'standard' | 'high';

/**
 * The tools ProjectOS can grant a specialist. CLOSED: nothing outside this list is grantable, and
 * every entry is side-effect free or sandboxed. A protected action is never a tool — it is a request
 * routed to the ProjectOS gate that owns it (`protectedActions.ts`).
 */
export type ToolName = 'read-repository' | 'search-repository' | 'run-sandbox-tests' | 'draft-proposal';
export const GRANTABLE_TOOLS: readonly ToolName[] = ['read-repository', 'search-repository', 'run-sandbox-tests', 'draft-proposal'];

export type EligibilityStatus = 'ineligible' | 'restricted' | 'fixture-eligible';

export interface CataloguePin {
  readonly upstream: string;
  readonly commit: string;
  readonly expectedAgents: number;
  readonly expectedDivisions: number;
  readonly licence: string;
  /** The approved quarantined cache: `<%baseEnv%>/<relative>/<commit>`, outside every repository. */
  readonly cacheLocation: { readonly baseEnv: string; readonly relative: string };
}

export interface WorkforceBounds {
  readonly maxTeamSize: number;
  readonly maxParallel: number;
  readonly maxContextBytes: number;
  readonly maxCostClass: CostClass;
  readonly maxLatencyMs: number;
  /** Tasks above this criticality are not given to the workforce; they escalate to the owner. */
  readonly maxCriticality: RiskLevel;
}

export interface WorkforceCeilings {
  readonly maxCallsPerExecution: number;
  readonly maxCostUnitsPerExecution: number;
  readonly costUnits: Readonly<Record<CostClass, number>>;
}

/** What ProjectOS configuration grants one role. Absent for a role = the registry's restrictive defaults. */
export interface RoleConfiguration {
  readonly capabilities: readonly string[];
  readonly applicablePhaseTypes: readonly TaskType[];
  readonly tools: readonly ToolName[];
  readonly readScopes: readonly string[];
  readonly writeScopes: readonly string[];
  readonly requiredInputs: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly costClass: CostClass;
  /** A reference into the model policy's `preferences`, never a model name. */
  readonly modelPreference: string;
  readonly parallelSafe: boolean;
  readonly implementation: boolean;
  readonly review: boolean;
  readonly riskTier: RiskTier;
}

export interface WorkforceConfig {
  readonly schemaVersion: 1;
  readonly configVersion: string;
  readonly catalogue: CataloguePin;
  /** `maxProposalItems` bounds one leader proposal (tasks + decisions + panels); `costClass` prices a consultation. */
  readonly leader: { readonly leaseBoundMs: number; readonly modelPreference: string; readonly maxProposalItems: number; readonly costClass: CostClass };
  /** Governance caps on any panel the leader declares. */
  readonly panels: { readonly maxRounds: number; readonly maxCostUnits: number; readonly maxContextBytes: number };
  readonly bounds: WorkforceBounds;
  readonly ceilings: WorkforceCeilings;
  readonly retries: { readonly maxAttemptsPerTask: number };
  readonly projection: { readonly maxEvents: number };
  readonly roles: Readonly<Record<string, RoleConfiguration>>;
}

export interface RegistrySource {
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
  readonly digest: string;
}

export interface RegistryEligibility {
  readonly status: EligibilityStatus;
  /** The evaluated models this status holds for. Fixture eligibility names fixture models only. */
  readonly models: readonly string[];
  readonly basis: string;
}

/**
 * One registered agent. Fields not derived from the source carry their MOST RESTRICTIVE default:
 * no tools, no scopes, no model, highest cost class, highest risk tier, not parallel safe, no role,
 * protected actions refused, ineligible.
 */
export interface RegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly source: RegistrySource;
  readonly division: string;
  readonly specialties: readonly string[];
  /** What the imported text DECLARES for itself (e.g. `tools`). Recorded; never honoured. */
  readonly sourceDeclares: readonly string[];
  readonly applicablePhaseTypes: readonly TaskType[];
  readonly capabilities: readonly string[];
  readonly tools: { readonly allowed: readonly ToolName[]; readonly forbidden: readonly string[] };
  readonly scopes: { readonly read: readonly string[]; readonly write: readonly string[] };
  readonly requiredInputs: readonly string[];
  readonly outputSchema: string;
  readonly evidenceRequirements: readonly string[];
  readonly costClass: CostClass;
  readonly modelPreferences: { readonly primary: string | null; readonly fallbacks: readonly string[] };
  readonly parallelSafe: boolean;
  readonly roles: { readonly implementation: boolean; readonly review: boolean };
  readonly protectedActionPolicy: 'refuse-all';
  readonly riskTier: RiskTier;
  readonly eligibility: RegistryEligibility;
}

export interface RegistryDocument {
  readonly schemaVersion: 1;
  readonly registryVersion: string;
  readonly catalogue: {
    readonly repository: string;
    readonly commit: string;
    readonly catalogueDigest: string;
    readonly licence: { readonly spdx: string; readonly notice: string };
    readonly divisionCount: number;
    readonly agentCount: number;
    readonly derivedAt: string;
    readonly derivedFrom: string;
  };
  readonly entries: readonly RegistryEntry[];
}

export interface SelectionPolicy {
  readonly schemaVersion: 1;
  readonly policyVersion: string;
  readonly defaultTaskType: TaskType;
  /** `roles` are mandatory for the task type; `supportingRoles` join only while every bound still holds. */
  readonly taskTypes: Readonly<
    Record<TaskType, { readonly roles: readonly string[]; readonly supportingRoles: readonly string[]; readonly maxTeam: number }>
  >;
  readonly factRoles: Readonly<Partial<Record<RiskFact, readonly string[]>>>;
  /**
   * RECORD-DERIVED FACTS. A path of the phase scope or of the candidate matching a pattern (`**` any
   * depth, `*` one segment) carries these facts. Governance-owned: the leader cannot change the map.
   */
  readonly pathFacts: readonly { readonly pattern: string; readonly facts: readonly RiskFact[] }[];
  /** The task type the record facts establish: the first rule whose facts intersect them wins. */
  readonly taskTypeByFacts: readonly { readonly anyOf: readonly RiskFact[]; readonly taskType: TaskType }[];
  readonly independentReview: {
    readonly requiredAtRisk: readonly RiskLevel[];
    readonly requiredForFacts: readonly RiskFact[];
    /** Candidate reviewer roles, tried in order: the first fact-specific list that applies, else `default`. */
    readonly reviewers: Readonly<Partial<Record<RiskFact | 'default', readonly string[]>>>;
  };
}

export interface ModelPolicy {
  readonly schemaVersion: 1;
  readonly policyVersion: string;
  /** Live execution by a real model is an activation input. While false, only fixture models resolve. */
  readonly liveExecutionActivated: false;
  readonly models: readonly { readonly ref: string; readonly kind: 'fixture'; readonly approved: boolean }[];
  /** Static substitution: `fallback` is used only when `primary` is unavailable — never a routing choice. */
  readonly preferences: Readonly<Record<string, { readonly primary: string; readonly fallback: string | null }>>;
}

export interface WorkforceGovernance {
  readonly acceptedCommit: string;
  /** The governed project, from the project config AT the owner-accepted commit — never the working tree. */
  readonly projectId: string;
  readonly config: WorkforceConfig;
  readonly registry: RegistryDocument;
  readonly selectionPolicy: SelectionPolicy;
  readonly modelPolicy: ModelPolicy;
  readonly digests: {
    readonly config: string;
    readonly registry: string;
    readonly selectionPolicy: string;
    readonly modelPolicy: string;
  };
}
