import { afterEach, expect, it } from 'vitest'
import { memoryIdentityStore } from '../activeIdentity'
import { createCoreServices, SecretService } from '../core'
import { makeTestDb, TEST_ENCRYPTION_KEY, type TestDb } from '../../testkit/db'
import { CapabilityRegistry } from './capabilities'
import { buildPluginContext } from './context'
import type { CompiledNodePluginContext } from './types'

let db: TestDb | null = null
afterEach(() => db?.cleanup())

// The composition roots fill `pluginSecurity` and `nodeKeys` after the plugins have initialized. A
// context that copied core at init never saw either, so the agents plugin's security check reported
// both as unavailable on every Node.
it('shows a plugin the core seams filled after its context was built', () => {
  db = makeTestDb()
  const core = createCoreServices({ secrets: new SecretService(TEST_ENCRYPTION_KEY), db: db.db, activeIdentity: memoryIdentityStore(null) })
  const ctx = buildPluginContext({ plugin: 'agents', capabilities: new CapabilityRegistry(), core }) as CompiledNodePluginContext
  expect(ctx.core.telemetry).not.toBe(core.telemetry)
  const nodeKeys = { snapshot: () => ({ delivery: 'desktop' as const, keyCheck: 'ok' as const, plainFiles: [] }) }
  core.nodeKeys = nodeKeys
  expect(ctx.core.nodeKeys).toBe(nodeKeys)
  // A spread of the context's core still carries every service a test helper replaces one of.
  expect({ ...ctx.core }.tasks).toBe(core.tasks)
})
