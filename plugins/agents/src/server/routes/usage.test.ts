import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '@acorn/plugin-api/testkit'
import { requireUser } from '@acorn/plugin-api/testkit'
import { SecretService } from '@acorn/plugin-api/testkit'
import { memoryIdentityStore } from '@acorn/plugin-api/testkit'
import { createCoreServices } from '@acorn/plugin-api/testkit'
import { makeTestDb } from '@acorn/plugin-api/testkit'
import type { AgentUsageSnapshot } from '../../shared/usage'
import { emptyAgentPricingPreferences, type AgentPricingPreferences } from '../../shared/pricing'
import { defaultAgentConcurrency, type AgentConcurrencyLimits } from '../../shared/concurrency'
import { readAgentPricingPreferences, writeAgentPricingPreferences } from '../pricingStore'
import { readAgentConcurrency, writeAgentConcurrency } from '../concurrencyStore'
import {
  defaultAgentSessionDefaults,
  type AgentSessionDefaults,
} from '../../shared/sessionDefaults'
import { readAgentSessionDefaults, writeAgentSessionDefaults } from '../sessionDefaultsStore'
import { customAgentRegistry, deleteCustomAgent, readCustomAgents, saveCustomAgent } from '../customAgents'
import type { CustomAgent } from '../../shared/customAgents'
import { agentUsage, setAgentUsageBridge } from './usage'
import type { Env } from '@acorn/plugin-api/testkit'

const snapshot: AgentUsageSnapshot = { providers: [], refreshedAt: 123 }

// The three usage cases only exercise `read`, but the bridge type is complete, so each stub fills the
// pricing, concurrency, and session-defaults halves too. Kept as one helper rather than repeated: a
// stub that silently answered the built-in table would make the persistence cases below pass vacuously.
const unusedSettings = {
  refreshProvider: async (): Promise<AgentUsageSnapshot | null> => {
    throw new Error('provider refresh is not part of this case')
  },
  pricing: async (): Promise<AgentPricingPreferences> => {
    throw new Error('pricing is not part of this case')
  },
  setPricing: async (): Promise<void> => {
    throw new Error('setPricing is not part of this case')
  },
  concurrency: async (): Promise<AgentConcurrencyLimits> => {
    throw new Error('concurrency is not part of this case')
  },
  setConcurrency: async (): Promise<void> => {
    throw new Error('setConcurrency is not part of this case')
  },
  sessionDefaults: async (): Promise<AgentSessionDefaults> => {
    throw new Error('sessionDefaults is not part of this case')
  },
  setSessionDefaults: async (): Promise<AgentSessionDefaults> => {
    throw new Error('setSessionDefaults is not part of this case')
  },
  customAgents: async (): Promise<CustomAgent[]> => {
    throw new Error('customAgents is not part of this case')
  },
  saveCustomAgent: async (): Promise<CustomAgent> => {
    throw new Error('saveCustomAgent is not part of this case')
  },
  deleteCustomAgent: async (): Promise<void> => {
    throw new Error('deleteCustomAgent is not part of this case')
  },
}
const request = (path: string, method = 'GET', body?: unknown) => new Request(
  `http://acorn.test${path}`,
  {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  },
)

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'james' })
    await next()
  })
  return app.route('/api/agents', agentUsage)
}

const gated = () => new Hono<AppEnv>().use('/api/*', requireUser).route('/api/agents', agentUsage)

// A child an agent spawned inside task1: an agent session's own ACORN_API_TOKEN.
const asTask1 = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })
    await next()
  })
  return app.route('/api/agents', agentUsage)
}

describe('agent usage routes', () => {
  afterEach(() => setAgentUsageBridge(null))

  it('reads cached usage and forces refresh through the typed bridge', async () => {
    const calls: Array<{ userId: string; force?: boolean }> = []
    const providerCalls: Array<{ userId: string; providerId: string }> = []
    setAgentUsageBridge({
      ...unusedSettings,
      read: async (options) => {
        calls.push(options)
        return snapshot
      },
      refreshProvider: async (options) => {
        providerCalls.push(options)
        return options.providerId === 'missing' ? null : snapshot
      },
    })
    const app = authed()
    expect(await (await app.fetch(request('/api/agents/usage'), {} as Env)).json()).toEqual(snapshot)
    expect(await (await app.fetch(request('/api/agents/usage/refresh', 'POST'), {} as Env)).json()).toEqual(snapshot)
    expect(await (await app.fetch(request('/api/agents/usage/refresh/claude', 'POST'), {} as Env)).json()).toEqual(snapshot)
    expect((await app.fetch(request('/api/agents/usage/refresh/missing', 'POST'), {} as Env)).status).toBe(404)
    expect(calls).toEqual([{ userId: 'james' }, { userId: 'james', force: true }])
    expect(providerCalls).toEqual([
      { userId: 'james', providerId: 'claude' },
      { userId: 'james', providerId: 'missing' },
    ])
  })

  it('401s without a principal', async () => {
    setAgentUsageBridge({ ...unusedSettings, read: async () => snapshot })
    expect((await gated().fetch(request('/api/agents/usage'), {} as Env)).status).toBe(401)
  })

  it('503s when the bridge is not wired', async () => {
    const response = await authed().fetch(request('/api/agents/usage'), {} as Env)
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('bridge-unavailable')
  })

  it('returns provider-local error rows as a successful response', async () => {
    setAgentUsageBridge({
      ...unusedSettings,
      read: async () => ({
        refreshedAt: 1,
        providers: [
          {
            provider: 'claude',
            label: 'Claude Code',
            availability: 'error',
            health: 'unknown',
            plan: null,
            account: null,
            quotas: [],
            cost: null,
            daily: null,
            capturedAt: null,
            stale: false,
            error: { code: 'authentication_required', message: 'Sign in.' },
          },
        ],
      }),
    })
    const response = await authed().fetch(request('/api/agents/usage'), {} as Env)
    expect(response.status).toBe(200)
    expect((await response.json()).providers[0].error.code).toBe('authentication_required')
  })

  // The pricing pane's round trip, through the bridge. The bridge is filled the way the plugin's init
  // fills it, over a real CoreServices whose `prefs` reads and writes core's `prefs` table, so this
  // asserts against real persistence. `env` is empty, so a pass proves the route never touches core's
  // handle.
  it('reads, validates, and persists plugin-owned pricing preferences', async () => {
    const testDb = makeTestDb()
    try {
      const core = createCoreServices({ secrets: new SecretService('33'.repeat(32)), db: testDb.db, activeIdentity: memoryIdentityStore() })
      setAgentUsageBridge({
        ...unusedSettings,
        read: async () => snapshot,
        pricing: (userId) => readAgentPricingPreferences(core.prefs, userId),
        setPricing: (userId, preferences) => writeAgentPricingPreferences(core.prefs, userId, preferences),
      })
      const app = authed()
      const env = {} as Env
      const initial = await app.fetch(request('/api/agents/pricing'), env)
      expect(await initial.json()).toEqual(emptyAgentPricingPreferences())

      const preferences = emptyAgentPricingPreferences()
      preferences.claude.customModels.push({
        model: 'claude-future',
        price: { input: 1, output: 2, cacheWrite: 1.25, cacheRead: 0.1 },
      })
      const saved = await app.fetch(request('/api/agents/pricing', 'PUT', preferences), env)
      expect(saved.status).toBe(200)
      expect(await saved.json()).toEqual(preferences)
      expect(await (await app.fetch(request('/api/agents/pricing'), env)).json()).toEqual(preferences)

      const invalid = await app.fetch(request('/api/agents/pricing', 'PUT', {
        version: 1,
        claude: { overrides: [], customModels: [{ model: '', price: {} }] },
      }), env)
      expect(invalid.status).toBe(400)
      expect((await invalid.json()).error.code).toBe('bad_request')
      expect(await (await app.fetch(request('/api/agents/pricing'), env)).json()).toEqual(preferences)
    } finally {
      testDb.cleanup()
    }
  })

  it('reads, validates, and persists the dispatch concurrency limits', async () => {
    const testDb = makeTestDb()
    try {
      const core = createCoreServices({ secrets: new SecretService('44'.repeat(32)), db: testDb.db, activeIdentity: memoryIdentityStore() })
      setAgentUsageBridge({
        ...unusedSettings,
        read: async () => snapshot,
        concurrency: (userId) => readAgentConcurrency(core.prefs, userId),
        setConcurrency: (userId, limits) => writeAgentConcurrency(core.prefs, userId, limits),
      })
      const app = authed()
      const env = {} as Env
      expect(await (await app.fetch(request('/api/agents/concurrency'), env)).json())
        .toEqual(defaultAgentConcurrency())

      const limits: AgentConcurrencyLimits = { provider: 6, workspace: 8 }
      const saved = await app.fetch(request('/api/agents/concurrency', 'PUT', limits), env)
      expect(saved.status).toBe(200)
      expect(await (await app.fetch(request('/api/agents/concurrency'), env)).json()).toEqual(limits)

      // Zero and a number past the ceiling are both refused, and neither disturbs what is stored.
      for (const body of [{ provider: 0, workspace: 8 }, { provider: 6, workspace: 500 }]) {
        const refused = await app.fetch(request('/api/agents/concurrency', 'PUT', body), env)
        expect(refused.status).toBe(400)
        expect((await refused.json()).error.code).toBe('bad_request')
      }
      expect(await (await app.fetch(request('/api/agents/concurrency'), env)).json()).toEqual(limits)
    } finally {
      testDb.cleanup()
    }
  })

  it('merges a new-session defaults write onto the values the runtime maintains', async () => {
    const testDb = makeTestDb()
    try {
      const core = createCoreServices({ secrets: new SecretService('44'.repeat(32)), db: testDb.db, activeIdentity: memoryIdentityStore() })
      setAgentUsageBridge({
        ...unusedSettings,
        read: async () => snapshot,
        sessionDefaults: (userId) => readAgentSessionDefaults(core.prefs, userId),
        setSessionDefaults: async (userId, patch) => {
          const merged = { ...await readAgentSessionDefaults(core.prefs, userId), ...patch }
          await writeAgentSessionDefaults(core.prefs, userId, merged)
          return merged
        },
      })
      const app = authed()
      const env = {} as Env
      expect(await (await app.fetch(request('/api/agents/session-defaults'), env)).json())
        .toEqual(defaultAgentSessionDefaults())

      // What the runtime writes as sessions change.
      const tracked = await app.fetch(
        request('/api/agents/session-defaults', 'PUT', { last: { codex: { reasoning: 'high' } } }),
        env,
      )
      expect(tracked.status).toBe(200)

      // Settings sends the checkbox and the pinned values, and must not flatten `last`.
      const pinned = await app.fetch(
        request('/api/agents/session-defaults', 'PUT', {
          followLastSession: false,
          pinned: { codex: { model: 'gpt-5.1-codex-max' } },
        }),
        env,
      )
      expect(pinned.status).toBe(200)
      expect(await (await app.fetch(request('/api/agents/session-defaults'), env)).json()).toEqual({
        continueAfterUsageLimit: true,
        stopIdleAfterMinutes: 30,
        keepArchivedHistoryDays: 0,
        followLastSession: false,
        inline: { providerId: null, pinned: {} },
        pinned: { codex: { model: 'gpt-5.1-codex-max' } },
        last: { codex: { reasoning: 'high' } },
      })

      // A value that is not a string is refused, and nothing stored moves.
      const refused = await app.fetch(
        request('/api/agents/session-defaults', 'PUT', { pinned: { codex: { model: 7 } } }),
        env,
      )
      expect(refused.status).toBe(400)
      expect((await refused.json()).error.code).toBe('bad_request')
      expect((await (await app.fetch(request('/api/agents/session-defaults'), env)).json() as AgentSessionDefaults).pinned)
        .toEqual({ codex: { model: 'gpt-5.1-codex-max' } })
    } finally {
      testDb.cleanup()
    }
  })
})

describe('custom agent routes', () => {
  afterEach(() => setAgentUsageBridge(null))

  const reviewer = {
    name: 'Bug reviewer',
    providerId: 'codex',
    profileId: 'codex',
    options: { reasoning: 'high' },
    instructions: 'Review for correctness only.',
    maxToolRisk: 'read',
  }

  it('creates, edits and deletes the owner’s agents, lists a plugin’s after them, and keeps a plugin’s read only', async () => {
    const testDb = makeTestDb()
    const disposePlugin = customAgentRegistry.register({
      id: 'lint:tidy', name: 'Tidy', providerId: 'claude', profileId: 'claude-code', options: {},
      source: { kind: 'plugin', pluginId: 'lint' },
    })
    try {
      const core = createCoreServices({ secrets: new SecretService('45'.repeat(32)), db: testDb.db, activeIdentity: memoryIdentityStore() })
      setAgentUsageBridge({
        ...unusedSettings,
        read: async () => snapshot,
        customAgents: (userId) => readCustomAgents(core.prefs, userId),
        saveCustomAgent: (userId, id, input) => saveCustomAgent(core.prefs, userId, id, input),
        deleteCustomAgent: (userId, id) => deleteCustomAgent(core.prefs, userId, id),
      })
      const app = authed()
      const env = {} as Env

      const created = await app.fetch(request('/api/agents/custom-agents', 'POST', reviewer), env)
      expect(created.status).toBe(200)
      const saved = await created.json() as CustomAgent
      expect(saved).toMatchObject({ ...reviewer, source: { kind: 'user' } })

      const edited = await app.fetch(request(`/api/agents/custom-agents/${saved.id}`, 'PUT', { ...reviewer, name: 'Reviewer' }), env)
      expect(edited.status).toBe(200)
      expect((await (await app.fetch(request('/api/agents/custom-agents'), env)).json() as CustomAgent[]).map((agent) => agent.name))
        .toEqual(['Reviewer', 'Tidy'])

      // A plugin's agent is listed but cannot be written through the owner's route.
      expect((await app.fetch(request('/api/agents/custom-agents/lint:tidy', 'PUT', reviewer), env)).status).toBe(400)
      // An unknown id is a 404 rather than a quiet create.
      expect((await app.fetch(request('/api/agents/custom-agents/missing', 'PUT', reviewer), env)).status).toBe(404)
      // An instruction past the ceiling is refused at the boundary.
      expect((await app.fetch(request('/api/agents/custom-agents', 'POST', { ...reviewer, instructions: 'x'.repeat(16_001) }), env)).status).toBe(400)

      expect((await app.fetch(request(`/api/agents/custom-agents/${saved.id}`, 'DELETE'), env)).status).toBe(200)
      expect((await (await app.fetch(request('/api/agents/custom-agents'), env)).json() as CustomAgent[]).map((agent) => agent.id))
        .toEqual(['lint:tidy'])
    } finally {
      disposePlugin()
      testDb.cleanup()
    }
  })

  // An agent here writes a later session's system prompt, so the credential a running agent holds must
  // not be able to create one.
  it('403s a write from a task-scoped credential and leaves the read open', async () => {
    let wrote = 0
    setAgentUsageBridge({
      ...unusedSettings,
      read: async () => snapshot,
      customAgents: async () => [],
      saveCustomAgent: async () => {
        wrote += 1
        throw new Error('unreachable')
      },
    })
    expect((await asTask1().fetch(request('/api/agents/custom-agents', 'POST', reviewer), {} as Env)).status).toBe(403)
    expect((await asTask1().fetch(request('/api/agents/custom-agents/x', 'DELETE'), {} as Env)).status).toBe(403)
    expect((await asTask1().fetch(request('/api/agents/custom-agents'), {} as Env)).status).toBe(200)
    expect(wrote).toBe(0)
  })
})

// `ownerId(c)` resolves to the same login for a device and for an agent-spawned child, so nothing else
// tells them apart. Without this check, a task-scoped agent could overwrite the cost table every usage
// figure in the app is computed against.
describe('writing pricing preferences needs a human', () => {
  afterEach(() => setAgentUsageBridge(null))

  it('403s a PUT from a task-scoped credential, without reaching the bridge or parsing the body', async () => {
    let wrote = 0
    setAgentUsageBridge({
      ...unusedSettings,
      read: async () => snapshot,
      pricing: async () => emptyAgentPricingPreferences(),
      setPricing: async () => void (wrote += 1),
    })
    // A body that would validate, so a 403 cannot be a 400 in disguise.
    const valid = emptyAgentPricingPreferences()
    const refused = await asTask1().fetch(request('/api/agents/pricing', 'PUT', valid), {} as Env)
    expect(refused.status).toBe(403)
    expect(wrote).toBe(0)
    // The control: the same request from a device is accepted.
    expect((await authed().fetch(request('/api/agents/pricing', 'PUT', valid), {} as Env)).status).toBe(200)
    expect(wrote).toBe(1)
  })

  it('leaves the READS open to an agent — a turn asking what it cost is reasonable', async () => {
    setAgentUsageBridge({
      ...unusedSettings,
      read: async () => snapshot,
      pricing: async () => emptyAgentPricingPreferences(),
      setPricing: async () => {},
    })
    const app = asTask1()
    expect((await app.fetch(request('/api/agents/pricing'), {} as Env)).status).toBe(200)
    expect((await app.fetch(request('/api/agents/usage'), {} as Env)).status).toBe(200)
  })
})
