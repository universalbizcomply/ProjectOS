// Origin: original ProjectOS code
/** Skill rules: pure, deterministic, no I/O. The agent owns the files, and an agent only proposes. */
export * from './refusal.js';
export * from './frontmatter.js';
export { foldSkillLines, hiddenTextFindings } from './hiddenText.js';
export * from './guardPatterns.js';
export { skillThreatFindings } from './guard.js';
export { auditPythonSource } from './sourceAudit.js';
export { MAX_SKILL_DESCRIPTION_CHARS, MAX_SKILL_NAME_CHARS, SKILL_MD, lintSkill, skillNameProblem, type SkillLintInput } from './linter.js';
export * from './skillPackage.js';
export {
  SKILL_PROPOSAL_STATES,
  SKILL_REVIEWER_ROLES,
  buildSkillProposal,
  checkPromotedSkill,
  checkSkillProposal,
  decideSkillProposal,
  isSkillPin,
  promoteSkill,
  readSkillProposal,
  type PromotedSkill,
  type SkillActor,
  type SkillDecisionOutcome,
  type SkillPin,
  type SkillProposal,
  type SkillProposalInput,
  type SkillProposalState,
  type SkillProvenance,
} from './promotion.js';
export { renderSkillBlock, type SkillPromptBlock } from './prompt.js';
