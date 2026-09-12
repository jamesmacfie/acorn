import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentProviderUsage, AgentUsageProviderId } from '../../shared/usage'
import { emptyAgentPricingPreferences } from '../../shared/pricing'
import { AgentUsageCollectorRegistry, type AgentUsageCollector } from './collectors'
import { createAgentUsageService } from './service'
import { UsageProcessError } from './processRunner'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const provider = (id: AgentUsageProviderId, percent = 80): AgentProviderUsage => ({
  provider: id,
  label: id,
  availability: 'available',
  health: 'healthy',
  plan: null,
  account: null,
  quotas: [{ id: 'session', label: 'Session', percentRemaining: percent, resetsAt: null, resetText: null, health: 'healthy' }],
  cost: null,
  daily: null,
  capturedAt: 1,
  stale: false,
  error: null,
})

// The service reads its collectors from a registry, so each test builds its own. The labels are what
// the service stamps onto every answer.
const collectorsFor = (claude: AgentUsageCollector, codex: AgentUsageCollector): AgentUsageCollectorRegistry => {
  const registry = new AgentUsageCollectorRegistry()
  registry.register({ provider: 'claude', label: 'Claude Code', collect: claude })
  registry.register({ provider: 'codex', label: 'Codex', collect: codex })
  return registry
}

async function probeDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'acorn-usage-service-'))
  roots.push(root)
  return join(root, 'probe')
}

describe('agent usage service', () => {
  it('runs both providers concurrently and preserves provider order', async () => {
    const releases: Array<() => void> = []
    const wait = () => new Promise<void>((resolve) => releases.push(resolve))
    let started = 0
    let resolveStarted!: () => void
    const allStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const markStarted = () => {
      started += 1
      if (started === 2) resolveStarted()
    }
    const service = createAgentUsageService({
      probeDir: await probeDir(),
      collectors: collectorsFor(
        async () => {
          markStarted()
          await wait()
          return provider('claude')
        },
        async () => {
          markStarted()
          await wait()
          return provider('codex')
        },
      ),
    })
    const result = service.read({ userId: 'james' })
    await allStarted
    expect(started).toBe(2)
    releases.splice(0).forEach((release) => release())
    expect((await result).providers.map((item) => item.provider)).toEqual(['claude', 'codex'])
  })

  it('uses TTL cache, joins in-flight work, and lets force bypass a settled cache', async () => {
    let clock = 1_000
    let calls = 0
    const service = createAgentUsageService({
      probeDir: await probeDir(),
      ttlMs: 100,
      now: () => clock,
      collectors: collectorsFor(async () => provider('claude', ++calls), async () => provider('codex')),
    })
    const first = service.read({ userId: 'james' })
    const joined = service.read({ userId: 'james', force: true })
    await Promise.all([first, joined])
    await service.read({ userId: 'james' })
    expect(calls).toBe(1)
    await service.read({ userId: 'james', force: true })
    expect(calls).toBe(2)
    clock += 101
    await service.read({ userId: 'james' })
    expect(calls).toBe(3)
  })

  it('keeps one provider when the other fails and marks last-good data stale on a later failure', async () => {
    let failClaude = false
    const service = createAgentUsageService({
      probeDir: await probeDir(),
      collectors: collectorsFor(
        async () => {
          if (failClaude) throw new UsageProcessError('timeout', 'Claude timed out.')
          return provider('claude', 72)
        },
        async () => provider('codex', 44),
      ),
    })
    await service.read({ userId: 'james' })
    failClaude = true
    const refreshed = await service.read({ userId: 'james', force: true })
    expect(refreshed.providers[0]).toMatchObject({
      provider: 'claude',
      stale: true,
      availability: 'available',
      error: { code: 'timeout' },
    })
    expect(refreshed.providers[0].quotas[0].percentRemaining).toBe(72)
    expect(refreshed.providers[1]).toMatchObject({ provider: 'codex', stale: false })
  })

  it('uses missing availability for an unavailable CLI without hiding the other provider', async () => {
    const service = createAgentUsageService({
      probeDir: await probeDir(),
      collectors: collectorsFor(
        async () => {
          throw new UsageProcessError('cli_missing', 'claude missing')
        },
        async () => provider('codex'),
      ),
    })
    const snapshot = await service.read({ userId: 'james' })
    expect(snapshot.providers[0]).toMatchObject({ provider: 'claude', availability: 'missing', error: { code: 'cli_missing' } })
    expect(snapshot.providers[1].availability).toBe('available')
  })

  it('invalidates cached estimates when the user pricing changes', async () => {
    let customInput = 1
    let calls = 0
    const service = createAgentUsageService({
      probeDir: await probeDir(),
      pricingForUser: async () => ({
        ...emptyAgentPricingPreferences(),
        claude: {
          overrides: [],
          customModels: [{
            model: 'claude-new',
            price: { input: customInput, output: 2, cacheWrite: 1, cacheRead: 0.1 },
          }],
        },
      }),
      collectors: collectorsFor(async () => provider('claude', ++calls), async () => provider('codex')),
    })

    await service.read({ userId: 'james' })
    await service.read({ userId: 'james' })
    expect(calls).toBe(1)
    customInput = 3
    await service.read({ userId: 'james' })
    expect(calls).toBe(2)
  })
})
