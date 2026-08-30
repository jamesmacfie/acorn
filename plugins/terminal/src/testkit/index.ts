// The node half of this package's test seam (docs/architecture-overview.md § Package boundaries).
// Client-side test exports live in ./client.ts, split for the reason @acorn/plugin-api splits its
// own testkit: one barrel carrying both halves puts DOM types into a node-only program.
//
//   apps/node/test/integration/coreTools.test.ts   runAgentTools
export { runAgentTools } from '../server/agentTools'
