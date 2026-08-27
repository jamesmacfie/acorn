// The test seam for this package (docs/architecture-overview.md § Package boundaries).
//
//   apps/node/test/integration/coreTools.test.ts   memoryAgentTools
//   apps/node/test/integration/memoryGen.test.ts   everything else
export { memoryAgentTools } from '../main/agentTools'
export { contentHashId } from '../main/memory'
export { MemoryProposalStore } from '../main/memoryProposals'
export {
  acceptProposal,
  generateMemoryProposals,
  MEMORY_REVIEW_SCHEMA,
  rejectProposal,
  verifyCandidates,
  type MemoryCandidate,
  type MemoryGenDeps,
} from '../main/memoryGen'
