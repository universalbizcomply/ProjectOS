// Origin: original ProjectOS code
/**
 * The agent computer's rules (PROJECTOS-PORT-COMPUTER1A): exec approval binding, allowlist patterns, a default-deny action
 * policy, a network policy and a kill plan, all as pure rules. Nothing calls them yet: the sandbox (Stage 4.3) is their
 * first caller. Each name is exported by name, so a new function is not public by default.
 */
export { readComputerClock, type ComputerClock } from './clock.js';
export { canonicalJsonOf as computerCanonicalJson, digestOfCanonical as computerDigest, digestOfText as computerDigestOfText } from './canonicalJson.js';
export { MAX_PATH_CHARS as MAX_EXEC_PATH_CHARS, canonicalPathOf as execCanonicalPath, type CanonicalPath as ExecCanonicalPath, type CanonicalPathResult as ExecCanonicalPathResult, type PathRefusal as ExecPathRefusal, type PathStyle as ExecPathStyle } from './pathCanon.js';
export { compileExecAllowlistPattern, type ExecAllowlistPattern, type ExecAllowlistPatternResult, type PatternRefusal as ExecPatternRefusal } from './allowlistPattern.js';
export { ALLOWABLE_SYNTAX, MAX_LINE_CHARS as MAX_COMMAND_LINE_CHARS, analyzeCommandLine, type CommandLineAnalysis, type SyntaxFeature as CommandSyntaxFeature } from './commandLine.js';
export { MAX_WRAPPER_DEPTH, normalizeExecutableToken as normalizeExecutableName, resolveWrapperPlan, type WrapperPlan as ExecWrapperPlan, type WrapperRefusal as ExecWrapperRefusal } from './wrapperResolution.js';
export { MAX_ENV_NAMES, admitExecEnvNames, deniedEnvName, type EnvNamesResult as ExecEnvNamesResult, type EnvRefusal as ExecEnvRefusal } from './execEnv.js';
export {
  MAX_ARGV_ENTRIES,
  MAX_ARG_CHARS,
  MAX_EXEC_OUTPUT_BYTES,
  MAX_EXEC_TIMEOUT_MS,
  isPreparedExec,
  prepareExecCommand,
  type ExecutableResolverPort,
  type PrepareRefusal as ExecPrepareRefusal,
  type PrepareResult as ExecPrepareResult,
  type PreparedExec,
} from './execCommand.js';
export { isExecLaunchPlan, type ExecLaunchPlan } from './execLaunch.js';
export { MAX_DISPLAY_OUTPUT_CHARS, describeExecForOwner, sanitizeExecDisplayText, type ExecDisplay, type ExecDisplayText } from './execDisplay.js';
export {
  EXEC_ACTION,
  EXEC_MODES,
  MAX_ALLOWLIST_ENTRIES,
  UNATTENDED_EXEC_CLASS,
  compileExecPolicy,
  evaluateExecPolicy,
  planAllowlistedExec,
  type CompileResult as ExecPolicyCompileResult,
  type ExecDecision,
  type ExecDecisionCode,
  type ExecMode,
  type ExecOutcome,
  type ExecPolicy,
  type PlanResult as ExecPlanResult,
  type PolicyRefusal as ExecPolicyRefusal,
} from './execPolicy.js';
export {
  DECISION_ID,
  GRANT_DECISIONS,
  MAX_GRANTS_PER_SCOPE,
  MAX_GRANTS_TOTAL,
  MAX_GRANT_TTL_MS,
  MIN_GRANT_TTL_MS,
  createExecGrantStore,
  type ConsumeResult as ExecGrantConsumeResult,
  type ExecGrant,
  type ExecGrantStore,
  type GrantRefusal as ExecGrantRefusal,
  type IssueResult as ExecGrantIssueResult,
} from './execGrants.js';
export {
  DEFAULT_GRACE_MS,
  KILL_PLATFORMS,
  MAX_GRACE_MS,
  normalizeGraceMs,
  planKillTree,
  type KillPlan,
  type KillPlanResult,
  type KillPlatform,
  type KillRefusal,
  type KillRequest,
  type KillSignal,
  type KillStep,
  type KillTarget,
} from './processTree.js';
export {
  COMPUTER_INTENTS,
  COMPUTER_TOOLS,
  INITIATOR_KINDS,
  canonicalHost as computerCanonicalHost,
  intentOf,
  readActionContext,
  type ComputerActionContext,
  type ComputerIntent,
  type ComputerTool,
  type ContextRefusal as ActionContextRefusal,
  type ContextResult as ActionContextResult,
  type InitiatorKind,
} from './actionContext.js';
export {
  COMPUTER_ACTION_PREFIX,
  MAX_POLICY_RULES,
  UNATTENDED_ACTION_CLASS,
  classOfComputerAction,
  compileActionPolicy,
  evaluateActionPolicy,
  floorReason,
  type ActionDecision,
  type ActionDecisionCode,
  type ActionPolicy,
  type ActionPolicyRefusal,
  type ActionPolicyResult,
  type ActionRule,
  type ActionRuleWhen,
} from './actionPolicy.js';
export {
  MAX_EGRESS_RULES,
  NETWORK_MODES,
  effectiveNetworkPolicy,
  egressAllowed,
  type EffectiveNetworkPolicy,
  type NetworkMode,
  type NetworkPolicyRow,
} from './networkPolicy.js';
export {
  BROWSER_CALLS,
  COMPUTER_USE_CALLS,
  SANDBOX_AVAILABLE_FROM,
  SANDBOX_NOT_AVAILABLE,
  createRefusingBrowser,
  createRefusingComputerUse,
  refuseSandboxCall,
  type BrowserPort,
  type ComputerUsePort,
  type SandboxRefusal,
  type SandboxSurface,
} from './sandboxRefusal.js';
export { MAX_FENCED_CHARS, OUTPUT_KINDS, fenceUntrustedOutput, type FencedOutput, type OutputKind } from './untrustedOutput.js';
