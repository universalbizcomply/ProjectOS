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
export {
  MAX_FINDINGS_RECORD_CHARS,
  MAX_PENDING_MEMORY_PER_AUTHOR,
  openProposalDoor,
  type AgentDoorCode,
  type DoorEntryOutcome,
  type ProposalDoorCaller,
  type ProposalDoorOutcome,
} from './proposalDoor.js';
export {
  MAX_STORE_DIGEST_DEPTH,
  MAX_STORE_DIGEST_FILES,
  MAX_STORE_DIGEST_TOTAL_BYTES,
  checkStoreUnchanged,
  snapshotMemoryStores,
  type MemoryStoreEntry,
  type MemoryStoreSnapshot,
  type MemoryStoreSnapshotRefusalCode,
  type MemoryStoreSnapshotResult,
  type StoreChange,
} from './storeDigest.js';
