import { expect, it, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('../../packages/client-core/src/infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
const { startClientSchedules, clientScheduleRegistry } = await import('../../packages/client-core/src/host/registries/shell/schedules')

it('records overlapping event-triggered runs through the actual client schedule owner', async () => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  let refresh!: () => void, calls = 0, active = 0, peak = 0
  const resolvers: (() => void)[] = []
  const registration = clientScheduleRegistry.register({ id: 'perf14-wave', intervalMs: 120_000,
    run: async () => { calls++; peak = Math.max(peak, ++active); await new Promise<void>(resolve => resolvers.push(resolve)); active-- },
    subscribe: callback => { refresh = callback; return () => {} },
  })
  const stop = startClientSchedules()
  try {
    for (let i = 0; i < 30; i++) refresh()
    const beforeRelease = { calls, active, peak }
    expect(calls).toBe(1)
    for (const release of resolvers.splice(0)) release()
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(calls).toBe(2)
    refresh()
    resolvers.shift()!()
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(calls).toBe(3)
    resolvers.shift()!()
    for (let i = 0; i < 8; i++) await Promise.resolve()
    const tag = process.env.ACORN_PERF_TAG ?? 'sample', output = resolve(`plans/performance/14-client-schedules-${tag}.json`)
    if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe evidence tag.')
    if (tag.startsWith('before') && existsSync(output)) throw new Error('Before evidence exists.')
    writeFileSync(output, JSON.stringify({ eventTriggers: 30, initialTriggers: 1, beforeRelease, afterRelease: { active, calls, peak },
      expected: 'One active run per schedule; intervening refresh edges mark a pending follow-up, which stops after disposal and respects document visibility.' }, null, 2) + '\n')
  } finally { stop(); registration.dispose() }
})
