// The node half of this package's test seam (docs/architecture/packages.md § Package boundaries).
// Client-side test exports live in ./client.ts, split for the reason @acorn/plugin-api splits its
// own testkit: one barrel carrying both halves puts DOM types into a node-only program.
//
//   apps/node/test/integration/harnessContribution.test.ts   agentDriverRegistry
//   apps/desktop/scripts/agent/seed.ts                        seedLargeSession
export { agentDriverRegistry } from '../server/drivers/registry'
export { seedLargeSession } from './largeSession'
export { seedDelegationCheckReport } from './delegationChecks'
export { seedUnattendedPolicy } from './unattendedPolicy'
export { seedCommandRestart } from './commandRestart'
