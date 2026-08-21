import { describe, expect, it } from 'vitest'
import type { InstalledPluginInfo, PluginLoadFailure } from '../../main/pluginLoader'
import type { PluginRosterEntry } from './host'
import { pluginState, type PluginsBridge } from './pluginState'

// Objects in, rows out. This logic used to live inside the route, so reaching it meant a Hono app and a
// nine-member fixture. The judgement calls it makes, what counts as stale, which gaps raise the restart
// banner, deserve a test that is only about them.
const NO_PERMISSIONS = { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } }
const NO_CONTRIBUTIONS = {
  frames: [], sources: [], slots: [], palette: [], commands: [], keybindings: [],
  attention: [], nodeStats: [], contentLinks: [], agentContexts: [], refResolvers: [], routes: [], themes: [],
  contextMenus: [], extensionPoints: [], extensions: [], collections: [],
  schedules: [], taskChecks: [],
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
  // Unstamped, and the helper adds the clock: what these cases are about is the reason text and the
  // resulting state, and every literal carrying an identical `at:` would only bury that.
  loadFailures?: Omit<PluginLoadFailure, 'at'>[]
}

// A fixed instant so a test can assert the row carries the loader's stamp rather than a fresh clock.
const FAILED_AT = 1_700_000_000_000

const bridge = (situation: Situation): PluginsBridge => {
  const onDisk = situation.installed ?? []
  return {
    roster: () => situation.roster ?? [],
    installed: () => onDisk,
    // The steady state is "what is on disk is what booted"; a test says otherwise only when it is
    // about the gap between the two.
    booted: () => situation.booted ?? onDisk.map((entry) => ({ id: entry.id, version: entry.version })),
    disabled: () => situation.disabled ?? [],
    loadFailures: () => (situation.loadFailures ?? []).map((failure) => ({ ...failure, at: FAILED_AT })),
    clientBundle: async () => null,
    setDisabled: () => {},
    install: async () => ({ id: '', version: '', state: 'installed-restart-required' }),
    update: async () => ({ id: '', fromVersion: '', toVersion: '', state: 'installed-restart-required' }),
    uninstall: () => ({ restartRequired: true, dataPurged: false }),
    reload: async () => ({ id: '', version: '', state: 'reloaded' }),
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

  it('carries the reason and the stage off a contained failure', () => {
    const result = pluginState(
      bridge({
        roster: [{
          name: 'ntfy',
          required: false,
          disabled: false,
          state: 'failed',
          failedAt: 1_700_000_000_000,
          reason: "TypeError: Cannot read properties of undefined (reading 'load')",
          stage: 'init',
        }],
      }),
    )
    expect(row(result, 'ntfy')).toMatchObject({
      state: 'failed',
      stage: 'init',
      reason: "TypeError: Cannot read properties of undefined (reading 'load')",
    })
  })

  it('caps a reason a plugin made enormous', () => {
    const result = pluginState(
      bridge({ roster: [{ name: 'ntfy', required: false, disabled: false, state: 'failed', reason: 'x'.repeat(5_000) }] }),
    )
    // Display text crossing from a loaded plugin's throw into the owner's UI. Truncated, not dropped:
    // the first sentence of a thrown message is almost always the useful one.
    expect(row(result, 'ntfy')?.reason?.length).toBe(400)
    expect(row(result, 'ntfy')?.reason?.endsWith('…')).toBe(true)
  })

  it('reports a package whose bundle would not import as failed, not pending-restart', () => {
    // The trap this whole seam exists for. The package is on disk with a parseable manifest, so it is in
    // `installed()`; the loader could not import it, so it is absent from `booted()`. That pair used to
    // read as "waiting for a restart", with a Restart banner that restarting could never clear, because
    // restarting re-runs the same failing import.
    const result = pluginState(
      bridge({
        installed: [installed('ntfy')],
        booted: [],
        loadFailures: [{ id: 'ntfy', dir: '/data/plugins/ntfy', reason: 'could not import node/index.js: SyntaxError: Unexpected end of input' }],
      }),
    )
    expect(row(result, 'ntfy')).toMatchObject({
      state: 'failed',
      stage: 'load',
      reason: 'could not import node/index.js: SyntaxError: Unexpected end of input',
      // The loader's own stamp, carried through. Without it the row had no timestamp at all and the
      // attention item fell back to 0, which renders as an event 56 years old.
      failedAt: FAILED_AT,
    })
    expect(result.restartRequired).toBe(false)
  })

  it('gives a package whose manifest never parsed a row of its own', () => {
    // Nothing else can: `scanInstalled` drops it, so it is in neither `installed()` nor the roster, and
    // before this the owner saw an installed plugin that simply was not in the list.
    const result = pluginState(
      bridge({
        loadFailures: [{ id: 'ntfy', dir: '/data/plugins/ntfy', reason: 'acorn-plugin.json does not match the manifest schema — contributions.frames[0].target: invalid value' }],
      }),
    )
    expect(row(result, 'ntfy')).toMatchObject({ state: 'failed', stage: 'load', required: false })
    expect(row(result, 'ntfy')?.reason).toContain('contributions.frames[0].target')
    expect(result.restartRequired).toBe(false)
  })

  it('reports a broken package whose name a running plugin already answers to', () => {
    // The dogfooding case: `build:plugin rollbar` installs a disk copy of a compiled-in plugin, and the
    // built-in steps aside only if the disk copy actually loads. When it does not, the built-in keeps
    // running and the roster row for that name is honestly 'active', so this failure used to be dropped
    // on the floor and the owner had no way to learn that the code running is not the copy they built.
    const result = pluginState(
      bridge({
        roster: [{ name: 'rollbar', required: false, disabled: false, state: 'active' }],
        loadFailures: [{ id: 'rollbar', dir: '/data/plugins/rollbar', reason: 'could not import node/index.js: SyntaxError' }],
      }),
    )
    // State untouched: something IS serving under this name, and calling it failed would send the owner
    // looking for an outage that is not happening.
    expect(row(result, 'rollbar')).toMatchObject({ state: 'active', running: true, stage: 'load', failedAt: FAILED_AT })
    expect(row(result, 'rollbar')?.reason).toContain('SyntaxError')
    // One row, not two. The name is the row key.
    expect(result.plugins.filter((entry) => entry.name === 'rollbar')).toHaveLength(1)
    expect(result.restartRequired).toBe(false)
  })

  it("leaves a contained plugin's own reason alone when a package also collides with its name", () => {
    // Its init threw, which is what the owner has to act on; the disk copy that could not be read is the
    // less useful of the two messages, so the more specific one wins.
    const result = pluginState(
      bridge({
        roster: [{ name: 'rollbar', required: false, disabled: false, state: 'failed', reason: 'init threw: TypeError', failedAt: 42, stage: 'init' }],
        loadFailures: [{ id: 'rollbar', dir: '/data/plugins/rollbar', reason: 'could not import node/index.js' }],
      }),
    )
    expect(row(result, 'rollbar')).toMatchObject({ state: 'failed', stage: 'init', reason: 'init threw: TypeError', failedAt: 42 })
  })

  it('lets the owner turn a broken package off, and stops shouting about it when they do', () => {
    const result = pluginState(
      bridge({
        disabled: ['ntfy'],
        loadFailures: [{ id: 'ntfy', dir: '/data/plugins/ntfy', reason: 'could not import node/index.js' }],
      }),
    )
    expect(row(result, 'ntfy')).toMatchObject({ state: 'disabled', disabled: true })
    expect(row(result, 'ntfy')?.reason).toBeUndefined()
    expect(result.restartRequired).toBe(false)
  })

  it('never raises the banner for a client-only package', () => {
    const result = pluginState(bridge({ installed: [installed('theme', { hasNode: false })], booted: [] }))
    expect(row(result, 'theme')).toMatchObject({ running: true, state: 'active' })
    expect(result.restartRequired).toBe(false)
  })
})
