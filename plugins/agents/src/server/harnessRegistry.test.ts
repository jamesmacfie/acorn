import { describe, expect, it } from 'vitest'
import { lineDelimitedJsonAdapter, textAdapter, type AgentProfileContribution, type ManifestHarness } from '@acorn/plugin-api/node'
import { createHarnessRegistry } from './harnessRegistry'
import { AgentDriverRegistry } from './drivers/registry'
import { AgentUsageCollectorRegistry } from './usage/collectors'
import { emptyAgentPricingPreferences } from '../shared/pricing'

// The consuming end of the harness seam. Pins two things: a contributed harness looks the same as a
// built-in one downstream, and each of a registration's three effects is conditional on the descriptor.

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
    // No usage probe and no terminal block, so neither exists. Most agent CLIs have no plan usage and
    // show no usage section.
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
    // The profile id is the harness id. Only `claude`/`claude-code` differ, because both names predate
    // this seam and both are persisted.
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
    // acorn decides that 12% remaining is critical, so one harness cannot call it healthy.
    expect(usage.quotas[0].health).toBe('critical')
    expect(usage.health).toBe('critical')
    // Neither is a harness's to answer.
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
    // `null`, not `false`, which would send the owner to re-authenticate an account that was fine. The
    // command is missing here, so the probe never runs; this pins that the driver was built with one.
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
    // the design, not an oversight.
    expect(profiles[0].headlessArgv).toBeUndefined()
    expect(profiles[0].streamJson).toBeUndefined()
    // And no one-shot mode either, so it is not a model backend: the block below is the opt-in.
    expect(profiles[0].aiArgv).toBeUndefined()

    handle.dispose()
    expect(profiles).toEqual([])
  })
})

// The one argv a manifest may assemble. Two variables in fixed positions, which is why it is admitted
// where `headlessArgv` and `resumeArgv` are refused, so what these pin is the positions.

const oneShotHarness = (oneShot: NonNullable<NonNullable<ManifestHarness['terminal']>['oneShot']>) =>
  harness({ terminal: { command: 'opencode', backendPreference: 'tmux', launchArgs: [], oneShot } })

const aiArgv = (
  oneShot: NonNullable<NonNullable<ManifestHarness['terminal']>['oneShot']>,
  opts: Parameters<NonNullable<AgentProfileContribution['aiArgv']>>[1],
) => {
  const { profiles, registry } = registries()
  registry.register(oneShotHarness(oneShot))
  return profiles[0].aiArgv!('opencode', opts)
}

const runOnce = { args: ['run'], output: 'text' as const, modelFlag: '--model' }

describe('a manifest one-shot block becomes an aiArgv', () => {
  it('puts the declared arguments first and the prompt last', () => {
    expect(aiArgv(runOnce, { prompt: 'Write a commit message.' })).toEqual({
      file: 'opencode',
      args: ['run', 'Write a commit message.'],
    })
  })

  it('carries a model behind the declared flag, and nothing when no model is asked for', () => {
    expect(aiArgv(runOnce, { prompt: 'p', model: 'anthropic/claude-sonnet-4-5' }).args)
      .toEqual(['run', '--model', 'anthropic/claude-sonnet-4-5', 'p'])
    expect(aiArgv(runOnce, { prompt: 'p' }).args).not.toContain('--model')
  })

  it('drops a model the harness declared no flag for, rather than passing it bare', () => {
    // A bare value would reach the CLI as a second positional argument where it expects one prompt.
    expect(aiArgv({ args: ['run'], output: 'text' }, { prompt: 'p', model: 'anthropic/claude-sonnet-4-5' }).args)
      .toEqual(['run', 'p'])
  })

  it('prepends the system half to the prompt, because a manifest cannot declare a flag for it', () => {
    expect(aiArgv(runOnce, { prompt: 'What colour is the sky?', system: 'Answer with a single word.' }).args)
      .toEqual(['run', 'Answer with a single word.\n\nWhat colour is the sky?'])
  })

  it('picks the stdout reading the block names', () => {
    const text = registries()
    text.registry.register(oneShotHarness({ args: ['run'], output: 'text' }))
    expect(text.profiles[0].streamJson).toBe(textAdapter)

    const json = registries()
    json.registry.register(oneShotHarness({ args: ['run', '--format', 'json'], output: 'json-lines' }))
    expect(json.profiles[0].streamJson).toBe(lineDelimitedJsonAdapter)
  })
})
