import { describe, expect, it } from 'vitest'
import type { InstalledPluginInfo } from '../../main/pluginLoader'
import type { PluginRosterEntry } from './host'
import { pluginState, type PluginsBridge } from './pluginState'

// Objects in, rows out. This logic used to live inside the route, so reaching it meant a Hono app and a
// nine-member fixture; the judgement calls it makes — what counts as stale, which gaps raise the restart
// banner — deserve a test that is only about them.
const NO_PERMISSIONS = { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } }
const NO_CONTRIBUTIONS = {
  frames: [], sources: [], slots: [], palette: [], commands: [], keybindings: [],
  attention: [], nodeStats: [], contentLinks: [], agentContexts: [], refResolvers: [], routes: [],
}
const installed = (id: string, over: Partial<InstalledPluginInfo> = {}): InstalledPluginInfo => ({
  id,
  version: '1.0.0',
  apiVersion: '1',
  permissions: NO_PERMISSIONS,
  contributions: NO_CONTRIBUTIONS,
  client: { hash: 'a'.repeat(64), bytes: 12 },
  hasNode: true,
  ...over,
})

type Situation = {
  roster?: PluginRosterEntry[]
  installed?: InstalledPluginInfo[]
  booted?: { id: string; version: string }[]
  disabled?: string[]
}

const bridge = (situation: Situation): PluginsBridge => {
  const onDisk = situation.installed ?? []
  return {
    roster: () => situation.roster ?? [],
    installed: () => onDisk,
    // The steady state is "what is on disk is what booted"; a test says otherwise only when it is
    // about the gap between the two.
    booted: () => situation.booted ?? onDisk.map((entry) => ({ id: entry.id, version: entry.version })),
    disabled: () => situation.disabled ?? [],
    clientBundle: async () => null,
    setDisabled: () => {},
    install: async () => ({ id: '', version: '', state: 'installed-restart-required' }),
    update: async () => ({ id: '', fromVersion: '', toVersion: '', state: 'installed-restart-required' }),
    uninstall: () => ({ restartRequired: true, dataPurged: false }),
  }
}

const row = (result: ReturnType<typeof pluginState>, name: string) => result.plugins.find((entry) => entry.name === name)

describe('pluginState', () => {
  it('reports a running node with nothing pending', () => {
    const result = pluginState(bridge({ roster: [{ name: 'github', required: false, disabled: false, state: 'active' }] }))
    expect(result.restartRequired).toBe(false)
    expect(row(result, 'github')).toMatchObject({ running: true, disabled: false, state: 'active' })
  })

  it('raises the banner for a plugin turned off but still serving', () => {
    const result = pluginState(
      bridge({ roster: [{ name: 'github', required: false, disabled: false, state: 'active' }], disabled: ['github'] }),
    )
    expect(row(result, 'github')).toMatchObject({ disabled: true, running: true })
    expect(result.restartRequired).toBe(true)
  })

  it('never disables a required plugin, whatever the file says', () => {
    const result = pluginState(
      bridge({ roster: [{ name: 'terminal', required: true, disabled: false, state: 'active' }], disabled: ['terminal'] }),
    )
    expect(row(result, 'terminal')).toMatchObject({ disabled: false, running: true })
    expect(result.restartRequired).toBe(false)
  })

  it('marks a package whose version moved under the running process as pending-restart', () => {
    const result = pluginState(
      bridge({
        roster: [{ name: 'ntfy', required: false, disabled: false, state: 'active' }],
        installed: [installed('ntfy', { version: '2.0.0' })],
        booted: [{ id: 'ntfy', version: '1.0.0' }],
      }),
    )
    expect(row(result, 'ntfy')?.state).toBe('pending-restart')
    expect(result.restartRequired).toBe(true)
  })

  it('leaves a failed plugin failed even when its directory also moved', () => {
    const result = pluginState(
      bridge({
        roster: [{ name: 'ntfy', required: false, disabled: false, state: 'failed', failedAt: 1_700_000_000_000 }],
        installed: [installed('ntfy', { version: '2.0.0' })],
        booted: [{ id: 'ntfy', version: '1.0.0' }],
      }),
    )
    // A restart cannot fix a plugin whose init throws, so it must not raise the banner.
    expect(row(result, 'ntfy')?.state).toBe('failed')
  })

  it('adds a just-installed package the host never saw, waiting on a restart', () => {
    const result = pluginState(bridge({ installed: [installed('ntfy')], booted: [] }))
    expect(row(result, 'ntfy')).toMatchObject({ running: false, state: 'pending-restart' })
    expect(result.restartRequired).toBe(true)
  })

  it('never raises the banner for a client-only package', () => {
    const result = pluginState(bridge({ installed: [installed('theme', { hasNode: false })], booted: [] }))
    expect(row(result, 'theme')).toMatchObject({ running: true, state: 'active' })
    expect(result.restartRequired).toBe(false)
  })
})
