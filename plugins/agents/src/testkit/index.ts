// The node half of this package's test seam (docs/architecture-overview.md § Package boundaries).
// Client-side test exports live in ./client.ts, split for the reason @acorn/plugin-api splits its
// own testkit: one barrel carrying both halves puts DOM types into a node-only program.
//
//   apps/node/test/integration/harnessContribution.test.ts   agentDriverRegistry
//   apps/desktop/scripts/agent/seed.ts                        seedLargeSession
export { agentDriverRegistry } from '../server/drivers/registry'
export { LARGE_SESSION_OLDEST_MARKER, LARGE_SESSION_PROFILES, largeSessionTurns, seedLargeSession } from './largeSession'
export type { LargeSessionProfile, LargeSessionTurn } from './largeSession'
