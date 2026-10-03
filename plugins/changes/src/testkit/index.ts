// The test seam for this package (docs/architecture/packages.md § Package boundaries).
//
//   apps/node/test/integration/coreTools.test.ts   localGitAgentTools
//   apps/desktop/scripts/agent/seed.ts             seedReviewNotes
export { localGitAgentTools } from '../server/agentTools'
export { seedReviewNotes } from './reviewNotes'
export type { SeedReviewNote } from './reviewNotes'
