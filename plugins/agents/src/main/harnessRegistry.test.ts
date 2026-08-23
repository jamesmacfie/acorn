import { describe, expect, it } from 'vitest'
import type { AgentProfileContribution, ManifestHarness } from '@acorn/plugin-api/node'
import { createHarnessRegistry } from './harnessRegistry'
import { AgentDriverRegistry } from './drivers/registry'
import { AgentUsageCollectorRegistry } from './usage/collectors'
import { emptyAgentPricingPreferences } from '../shared/pricing'

// The consuming end of the harness seam. What is worth pinning is that a contributed harness is
// indistinguishable from a built-in one downstream, and that the three effects a registration can have
// are each conditional on what the descriptor declared.

const harness = (over: Partial<ManifestHarness> = {}): ManifestHarness => ({
  id: 'opencode:opencode',
  pluginId: 'opencode',
  label: 'OpenCode',
  spawn: { command: 'acorn-harness-that-does-not-exist', args: ['acp'] },
  envPassthrough: ['OPENCODE_*'],
  quirks: { manualCompaction: true, sessionPersistence: false },
  ...over,
})

const registries = () => {
  const drivers = new AgentDriverRegistry()
  const collectors = new AgentUsageCollectorRegistry()
  const profiles: AgentProfileContribution[] = []
  const registry = createHarnessRegistry({
    drivers,
    collectors,
    profiles: {
      register: (profile) => {
        profiles.push(profile)
        return () => void profiles.splice(profiles.indexOf(profile), 1)
      },
    },
  })
  return { drivers, collectors, profiles, registry }
}

describe('a contributed harness becomes a driver like any other', () => {
  it('registers only a driver when the descriptor declares nothing else', () => {
    const { drivers, collectors, profiles, registry } = registries()
    const handle = registry.register(harness())

    expect(drivers.providers()).toEqual(['opencode:opencode'])
    // No usage probe and no terminal block, so neither exists. A harness with no plan usage simply shows
    // no usage section, which is the right answer for most agent CLIs.
    expect(collectors.entries()).toEqual([])
    expect(profiles).toEqual([])

    handle.dispose()
    expect(drivers.providers()).toEqual([])
  })

  it('carries the descriptor through to the driver it builds', async () => {
    const { drivers, registry } = registries()
    registry.register(harness())

    const driver = drivers.create('opencode:opencode')!
    expect(driver.providerId).toBe('opencode:opencode')
    // The profile id is the harness id. Only `claude`/`claude-code` differ, because both predate this
    // seam and both are persisted.
    expect(driver.profileId).toBe('opencode:opencode')

    const descriptor = await driver.probe()
    expect(descriptor.label).toBe('OpenCode')
    expect(descriptor.driverKind).toBe('acp')
    // Derived from the declared quirks, not from an id list inside acorn.
    expect(descriptor.capabilities).toContain('compact')
    expect(descriptor.capabilities).not.toContain('resume')
    // The command is not installed in this suite, which is a diagnostic rather than a throw.
    expect(descriptor.installed).toBe(false)
  })

  it('turns a usage probe into a collector and derives the health itself', async () => {
    const { collectors, registry } = registries()
    registry.register(harness({
      probeUsage: async () => ({
        plan: 'Pro',
        quotas: [{ id: 'session', label: 'Session', percentRemaining: 12 }],
      }),
    }))

    const [entry] = collectors.entries()
    expect(entry).toMatchObject({ provider: 'opencode:opencode', label: 'OpenCode' })
    const usage = await entry.collect(emptyAgentPricingPreferences())
    expect(usage.plan).toBe('Pro')
    // 12% remaining is critical, and acorn decides that, so one harness cannot call it healthy while
    // another calls it critical.
    expect(usage.quotas[0].health).toBe('critical')
    expect(usage.health).toBe('critical')
    // Neither is something a harness can answer about itself.
    expect(usage.cost).toBeNull()
    expect(usage.daily).toBeNull()
  })

  it('refuses a usage answer it cannot read, rather than inventing one', async () => {
    const { collectors, registry } = registries()
    registry.register(harness({ probeUsage: async () => ({ quotas: 'lots' }) }))
    await expect(collectors.entries()[0].collect(emptyAgentPricingPreferences())).rejects.toThrow(/shape acorn cannot read/)
  })

  it('reads an unusable auth answer as “cannot tell”, never as signed out', async () => {
    const { drivers, registry } = registries()
    registry.register(harness({ probeAuth: async () => ({ authenticated: 'yes' }) }))
    // `null`, not `false`: claiming a signed-in account is signed out would send the owner to
    // re-authenticate something that was fine. The command is missing here anyway, so the probe is not
    // reached — what this pins is that the driver was built with one at all.
    expect(await drivers.create('opencode:opencode')!.probe()).toMatchObject({ authenticated: null })
  })

  it('registers a terminal profile with the data parts only', () => {
    const { profiles, registry } = registries()
    const handle = registry.register(harness({
      terminal: { command: 'opencode', backendPreference: 'tmux', launchArgs: ['--acorn'] },
    }))

    expect(profiles).toEqual([{
      id: 'opencode:opencode',
      label: 'OpenCode',
      kind: 'agent',
      command: 'opencode',
      backendPreference: 'tmux',
      transport: 'pty',
      launchArgs: ['--acorn'],
    }])
    // No headless argv and no stream-JSON adapter, so a workflow step cannot name this harness. That is
    // the line the design draws, not an oversight.
    expect(profiles[0].headlessArgv).toBeUndefined()
    expect(profiles[0].streamJson).toBeUndefined()

    handle.dispose()
    expect(profiles).toEqual([])
  })
})
