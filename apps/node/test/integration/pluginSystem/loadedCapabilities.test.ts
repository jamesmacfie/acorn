import { afterEach, expect, it, vi } from 'vitest'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices, SecretService } from '@acorn/node-core/server/core/index.ts'
import { CapabilityRegistry, capabilityId } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import type { NodePlugin } from '@acorn/node-core/server/pluginHost'
import { makeTestDb, testCoreSeams, type TestDb } from '@acorn/node-core/testkit'
import { accountPlugin } from '@acorn/plugin-account/node/index.ts'
import { ACCOUNT_SERVICE } from '@acorn/plugin-account/contract/service.ts'
import { TERMINAL_SESSIONS } from '@acorn/plugin-terminal/contract/sessions.ts'
import { TERMINAL_SEND_TO_AGENT } from '@acorn/plugin-terminal/contract/sendToAgent.ts'
import { TERMINAL_RUN_TARGETS } from '@acorn/plugin-terminal/contract/runTargets.ts'
import { AGENTS_PROFILES } from '@acorn/plugin-agents/contract/sessionExecute.ts'

// What a loaded plugin's manifest can reach through `permissions.node.capabilities`, through the real
// host: the account plugin itself, built-ins standing in for terminal and agents under their real ids,
// and two loaded plugins (docs/plugins/collaboration.md § Capability ids).

let core: TestDb | null = null
let plugins: Awaited<ReturnType<typeof initPlugins>> | null = null
afterEach(async () => {
  await plugins?.dispose()
  core?.cleanup()
  vi.unstubAllGlobals()
})

const PRIVATE = [ACCOUNT_SERVICE, TERMINAL_SESSIONS, TERMINAL_SEND_TO_AGENT, TERMINAL_RUN_TARGETS] as string[]
const DEPLOYS = capabilityId<() => string>('acme-data.deploys')

it('keeps the terminal and account capabilities from a loaded plugin that declares them', async () => {
  const network = vi.fn(async () => new Response('{}'))
  vi.stubGlobal('fetch', network)
  const launched = vi.fn()
  // Standing in for the terminal plugin: every call would start a process as the Node's owner.
  const terminal: NodePlugin = {
    name: 'terminal',
    init: (ctx) => {
      for (const id of [TERMINAL_SESSIONS, TERMINAL_SEND_TO_AGENT, TERMINAL_RUN_TARGETS])
        ctx.capabilities.provide(capabilityId(id), { spawn: launched, send: launched, start: launched })
    },
  }
  const agents: NodePlugin = {
    name: 'agents',
    init: (ctx) => void ctx.capabilities.provide(AGENTS_PROFILES, { list: async () => [], backends: async () => [] }),
  }
  const provider: NodePlugin = {
    name: 'acme-data',
    init: (ctx) => void ctx.capabilities.provide(DEPLOYS, () => 'deploys'),
  }
  const seen: { resolved: Record<string, unknown>; ids: readonly string[]; required: string[] } = {
    resolved: {},
    ids: [],
    required: [],
  }
  const consumer: NodePlugin = {
    name: 'acme-tracker',
    // Ready, so every provider has finished its init.
    init: () => {},
    ready: (ctx) => {
      for (const id of [...PRIVATE, AGENTS_PROFILES, DEPLOYS])
        seen.resolved[id] = ctx.capabilities.get(capabilityId(id))
      seen.ids = ctx.capabilities.ids()
      for (const id of PRIVATE) {
        try {
          ctx.capabilities.require(capabilityId(id))
        } catch (error) {
          seen.required.push((error as Error).message)
        }
      }
    },
  }
  const loaded = (capabilities: string[]) => ({
    permissions: { core: [], capabilities, secrets: false, exec: false, net: [], sockets: false },
    storage: {
      open: () => {
        throw new Error('no storage in this test')
      },
    },
  })

  core = makeTestDb()
  plugins = await initPlugins([accountPlugin(), terminal, agents, provider, consumer], {
    capabilities: new CapabilityRegistry(),
    core: createCoreServices({
      secrets: new SecretService('0'.repeat(64)),
      db: core.db,
      activeIdentity: memoryIdentityStore('james'),
      ...testCoreSeams(),
    }),
    dataDir: '',
    loaded: new Map([
      ['acme-data', loaded([])],
      ['acme-tracker', loaded([...PRIVATE, AGENTS_PROFILES, DEPLOYS])],
    ]),
  })

  expect(plugins.failed).toEqual([])
  for (const id of PRIVATE) expect(seen.resolved[id], id).toBeUndefined()
  expect(seen.required).toEqual(PRIVATE.map((id) => `Required capability not provided: ${id}`))
  // What acorn publishes to loaded plugins, and what another loaded plugin provides, still resolve.
  expect(seen.resolved[AGENTS_PROFILES]).toBeDefined()
  expect((seen.resolved[DEPLOYS] as () => string)()).toBe('deploys')
  expect([...seen.ids].sort()).toEqual([DEPLOYS, AGENTS_PROFILES].sort())
  expect(launched).not.toHaveBeenCalled()
  expect(network).not.toHaveBeenCalled()
})
