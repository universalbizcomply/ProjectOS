// Origin: original ProjectOS code
/** Memory on the agent's `System` port. Writes go through the proposal queue and nothing else. */
export { loadMemoryBlock, readMemoryStore, memoryDir, memoryStorePath, memoryProvenancePath } from './memoryFiles.js';
export {
  approveMemoryProposal,
  listPendingMemoryProposals,
  loadMemoryProposal,
  proposeMemoryWrite,
  rejectMemoryProposal,
  type MemoryCaller,
  type MemoryDecisionRequest,
  type MemoryProposalListing,
  type MemoryWriteRequest,
} from './proposalQueue.js';
