// Origin: original ProjectOS code
/** Skills on the agent's `System` port. An agent proposes, and only a review promotes. */
export {
  importSkill,
  listPendingSkillProposals,
  loadPromotedSkill,
  loadSkillProposal,
  promotedSkillPath,
  proposeSkill,
  rejectSkillProposal,
  reviewAndPromoteSkill,
  skillsDir,
  type SkillPromotionPorts,
  type SkillProposalListing,
  type SkillProposalRequest,
  type SkillReviewRequest,
} from './skillQueue.js';
