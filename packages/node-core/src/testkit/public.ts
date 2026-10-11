export { testGate } from './auth.ts'
export { startControlPlaneStub } from './controlPlaneStub.ts'
export type { ControlPlaneStub } from './controlPlaneStub.ts'
export { makeTestCoreServices, makeTestDb, makeTestPluginDb, testEnv, testSecretEnv } from './db.ts'
export { beginTaskArchive, finishTaskArchive } from '../server/worktrees/archiveGate.ts'
export type { TestDb, TestPluginDb } from './db.ts'
export { seedProviderConnection } from './integration.ts'
export { PLUGIN_CONFIG_FILE, validatePluginConfig } from './manifest.ts'
export { mountCovers } from './mountCoverage.ts'
export { resetTelemetryForTest } from '../server/telemetry/collector.ts'
export { makeTestNodeContext, makeTestRequestContext } from './pluginContext.ts'
export type { TestNodeContext } from './pluginContext.ts'
export { testAgentToolDescriptor, testContextSectionDescriptor, testCliCommandDescriptor } from './runtimeContributions.ts'
export { runDashboard } from '../server/dashboards/run.ts'

// Seed authenticated legacy proposal records in migration fixtures.
export { issueAgentToolProvenance } from '../server/agentTools/provenance'

// The skill catalogue as the host fills it from a loaded package (docs/managed-agents/skills.md § Skills).
// Here rather than on the plugins barrel, which the Node imports at boot and the reader must stay out of.
export { readPackageSkill } from '../server/plugins/skills.ts'
export { skillStateStore } from '../server/plugins/skillState.ts'
export { catalogueSkills, registerSkill, skillDeliveries } from '../server/pluginHost/skills.ts'
