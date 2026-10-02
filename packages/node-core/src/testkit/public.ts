export { testGate } from './auth.ts'
export { startControlPlaneStub } from './controlPlaneStub.ts'
export type { ControlPlaneStub } from './controlPlaneStub.ts'
export { makeTestCoreServices, makeTestDb, makeTestPluginDb, testEnv, testSecretEnv } from './db.ts'
export type { TestDb, TestPluginDb } from './db.ts'
export { seedProviderConnection } from './integration.ts'
export { PLUGIN_CONFIG_FILE, validatePluginConfig } from './manifest.ts'
export { resetTelemetryForTest } from '../server/telemetry/collector.ts'
export { makeTestNodeContext, makeTestRequestContext } from './pluginContext.ts'
export type { TestNodeContext } from './pluginContext.ts'
export { testAgentToolDescriptor, testContextSectionDescriptor, testCliCommandDescriptor } from './runtimeContributions.ts'

// Seed authenticated legacy proposal records in migration fixtures.
export { issueAgentToolProvenance } from '../server/agentTools/provenance'
