// Origin: original ProjectOS code
/** Skills on the agent's `System` port. An agent proposes, and only a review promotes. */
export {
  listPendingSkillProposals,
  loadPromotedSkill,
  loadSkillBlock,
  loadSkillProposal,
  promotedSkillPath,
  proposeSkill,
  rejectSkillProposal,
  reviewAndPromoteSkill,
  skillsDir,
  type SkillProposalListing,
  type SkillProposalRequest,
  type SkillReviewRequest,
} from './skillQueue.js';
