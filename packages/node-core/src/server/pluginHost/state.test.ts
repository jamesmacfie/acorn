import { afterEach, describe, expect, it } from 'vitest'
import { clearDataSources, registerDataSource } from '../dataSources/registry'
import type { ActivePluginSnapshot, InstalledPluginInfo, PluginLoadFailure } from '../plugins/loader'
import type { PluginRosterEntry } from './host'
import { pluginState, type PluginsBridge } from './state'
import type { InputGrant } from '../plugins/inputGrants'
import type { PluginDevelopmentState } from '../plugins/development'

// Objects in, rows out. This logic used to live inside the route, so reaching it meant a Hono app and a
// nine-member fixture. The judgement calls it makes, what counts as stale, which gaps raise the restart
// banner, deserve a test that is only about them.
const NO_PERMISSIONS = { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } }
const NO_CONTRIBUTIONS = {
  frames: [], remote: [], sources: [], slots: [], commands: [], keybindings: [],
  attention: [], nodeStats: [], contentLinks: [], agentContexts: [], refResolvers: [], routes: [], themes: [], styles: [],
  contextMenus: [], extensionPoints: [], extensions: [],
  schedules: [], taskChecks: [], auditActions: [], harnesses: [], customAgents: [], agentTools: [], contextSections: [], cliCommands: [],
}
const installed = (id: string, over: Partial<InstalledPluginInfo> = {}): InstalledPluginInfo => ({
  id,
  label: `Plugin ${id}`,
  version: '1.0.0',
  apiVersion: '1',
  permissions: NO_PERMISSIONS,
  emits: [],
  contributions: NO_CONTRIBUTIONS,
  client: { hash: 'a'.repeat(64), bytes: 12 },
  hasNode: true,
  ...over,
})
const activeSnapshot = (id: string, version: string): ActivePluginSnapshot => {
  const { id: _id, label: _label, hasNode: _hasNode, source: _source, installedAt: _installedAt, bundled: _bundled, ...identity } = installed(id, { version })
  return { id, identity: { ...identity, activation: 'node' }, bundle: null }
}

type Situation = {
  roster?: PluginRosterEntry[]
  installed?: InstalledPluginInfo[]
  booted?: { id: string; version: string }[]
  disabled?: string[]
  // Unstamped, and the helper adds the clock: what these cases are about is the reason text and the
  // resulting state, and every literal carrying an identical `at:` would only bury that.
  loadFailures?: Omit<PluginLoadFailure, 'at'>[]
  review?: Record<string, { reviewId: string; requestId: string; fingerprint: string; stagedAt: number } | { corrupt: true }>
  grants?: InputGrant[]
  development?: Record<string, PluginDevelopmentState>
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
    booted: () => (situation.booted ?? onDisk.map((entry) => ({ id: entry.id, version: entry.version })))
      .map((entry) => activeSnapshot(entry.id, entry.version)),
    disabled: () => situation.disabled ?? [],
    loadFailures: () => (situation.loadFailures ?? []).map((failure) => ({ ...failure, at: FAILED_AT })),
    pendingReview: (id) => situation.review?.[id] ?? null,
    pendingReviewIds: () => Object.keys(situation.review ?? {}),
    approveReview: () => { throw new Error('not under test') },
    clientBundle: async () => null,
    setDisabled: () => {},
    install: async () => ({ id: '', version: '', state: 'installed-restart-required' }),
    update: async () => ({ id: '', fromVersion: '', toVersion: '', state: 'installed-restart-required' }),
    uninstall: () => ({ restartRequired: true, dataPurged: false }),
    reload: async () => ({ id: '', version: '', state: 'reloaded' }),
    inputGrants: () => ({ get: (id) => situation.grants?.find((grant) => grant.pluginId === id), set: () => {}, delete: () => {} }),
    development: { state: (id) => situation.development?.[id], set: () => {}, logs: () => null, reload: () => Promise.reject(new Error('not under test')), dispose: () => {} },
  }
}

const row = (result: ReturnType<typeof pluginState>, name: string) => result.plugins.find((entry) => entry.name === name)

describe('pluginState', () => {
  it('holds a staged client-only package and an orphan marker for recovery without a restart banner', () => {
    const review = { reviewId: 'r', requestId: 'q', fingerprint: 'f', stagedAt: 1 }
    const candidate = installed('client-only', { hasNode: false })
    const state = pluginState(bridge({ installed: [candidate], booted: [], review: { 'client-only': review, orphan: { corrupt: true } } }))
    expect(row(state, 'client-only')).toMatchObject({ state: 'pending-review', running: false, active: null, pendingReview: { reviewId: 'r', fingerprint: 'f', stagedAt: 1 } })
    expect(row(state, 'orphan')).toMatchObject({ state: 'pending-review', running: false, pendingReview: { corrupt: true } })
    expect(state.restartRequired).toBe(false)
  })

  it('keeps an invalid staged manifest removable when the loader has no installed row', () => {
    const state = pluginState(bridge({
      loadFailures: [{ id: 'broken', dir: '/data/plugins/broken', reason: 'manifest does not parse' }],
      review: { broken: { corrupt: true } },
    }))
    expect(row(state, 'broken')).toMatchObject({
      state: 'pending-review', running: false, active: null,
      pendingReview: { corrupt: true }, stage: 'load', reason: 'manifest does not parse',
    })
    expect(state.restartRequired).toBe(false)
  })
  it('reports a running node with nothing pending', () => {
    const result = pluginState(bridge({ roster: [{
      name: 'github', required: false, disabled: false, state: 'active',
      emits: [{ verb: 'pr-synced', description: 'A pull request mirror changed' }],
    }] }))
    expect(result.restartRequired).toBe(false)
    expect(row(result, 'github')).toMatchObject({
      running: true,
      disabled: false,
      state: 'active',
      emits: [{ verb: 'pr-synced', description: 'A pull request mirror changed' }],
    })
  })

  it('names each plugin for people, from its definition or its manifest', () => {
    const result = pluginState(bridge({
      roster: [
        { name: 'github', label: 'GitHub', required: false, disabled: false, state: 'active' },
        { name: 'ntfy', required: false, disabled: false, state: 'active' },
        { name: 'bare', required: false, disabled: false, state: 'active' },
      ],
      installed: [installed('ntfy'), installed('fresh')],
      booted: [{ id: 'ntfy', version: '1.0.0' }],
    }))
    expect(row(result, 'github')?.label).toBe('GitHub')
    expect(row(result, 'ntfy')?.label).toBe('Plugin ntfy')
    expect(row(result, 'fresh')?.label).toBe('Plugin fresh')
    // No name to give, so the key is absent and the client falls back to the id.
    expect(row(result, 'bare')).not.toHaveProperty('label')
    // The label rides the row, never the declaration, so a rename cannot read as a different package.
    expect(row(result, 'ntfy')?.installed).not.toHaveProperty('label')
    expect(row(result, 'ntfy')?.active).not.toHaveProperty('label')
    expect(row(result, 'ntfy')?.state).toBe('active')
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
    expect(row(result, 'ntfy')?.active).toMatchObject({ version: '1.0.0', client: { hash: 'a'.repeat(64) } })
    expect(row(result, 'ntfy')?.installed?.version).toBe('2.0.0')
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
    // A failed reload leaves the old runtime serving, while the newer disk candidate will be tried
    // at restart. The failure remains visible beside the honest restart requirement.
    expect(row(result, 'ntfy')?.state).toBe('failed')
    expect(row(result, 'ntfy')?.active?.version).toBe('1.0.0')
    expect(result.restartRequired).toBe(true)
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

  it('keeps a serving node half authoritative when its disk replacement is client-only', () => {
    const result = pluginState(bridge({
      roster: [{ name: 'theme', required: false, disabled: false, state: 'active' }],
      installed: [installed('theme', { version: '2.0.0', hasNode: false })],
      booted: [{ id: 'theme', version: '1.0.0' }],
    }))
    expect(row(result, 'theme')).toMatchObject({ state: 'pending-restart', active: { version: '1.0.0', activation: 'node' }, installed: { version: '2.0.0' } })
    expect(result.restartRequired).toBe(true)
  })
})

describe('what a loaded plugin reads', () => {
  afterEach(() => clearDataSources('github'))
  const readiness = installed('readiness', {
    contributions: {
      ...NO_CONTRIBUTIONS,
      dataSources: [{
        sourceId: 'board', name: 'Release readiness', singular: 'Issue', plural: 'Issues', identityScope: 'issue', handler: '/v1/p/readiness/board',
        inputs: {
          pulls: { source: 'github:pull-requests', label: 'Their pulls' },
          issues: { source: 'linear:issues', label: 'Issues', optional: true },
        },
      }],
    },
  })

  it('words each input from its source and owner, and marks what the grant covers', () => {
    registerDataSource('github', {
      sourceId: 'pull-requests', name: 'Pull requests', singular: 'Pull request', plural: 'Pull requests',
      identityScope: 'pr', providerId: 'github', handler: '/v1/p/github/pulls',
    })
    const result = pluginState(bridge({
      roster: [{ name: 'github', label: 'GitHub', required: false, disabled: false, state: 'active' }, { name: 'readiness', required: false, disabled: false, state: 'active' }],
      installed: [readiness],
      grants: [{ pluginId: 'readiness', sources: { board: { pulls: { source: 'github:pull-requests', optional: false } } }, grantedAt: 1, grantedBy: 'device:d1' }],
    }))
    expect(row(result, 'readiness')?.inputs).toEqual({
      granted: true,
      inputs: [
        { sourceId: 'board', name: 'pulls', source: 'github:pull-requests', optional: false, label: 'Their pulls', plural: 'Pull requests', provider: 'GitHub', approved: true },
        // Not registered on this node, so it has no plural, and its owner's id names it.
        { sourceId: 'board', name: 'issues', source: 'linear:issues', optional: true, label: 'Issues', provider: 'linear', approved: false },
      ],
    })
  })

  it('reports nothing granted before the first approval, and nothing at all for a plugin without inputs', () => {
    const result = pluginState(bridge({ installed: [readiness, installed('plain')] }))
    expect(row(result, 'readiness')?.inputs?.granted).toBe(false)
    expect(row(result, 'readiness')?.inputs?.inputs.every((input) => !input.approved)).toBe(true)
    expect(row(result, 'plain')?.inputs).toBeUndefined()
  })
})

describe('development mode', () => {
  const roster: PluginRosterEntry[] = [{ name: 'folder', required: false, disabled: false, state: 'active' }]

  it('offers it only for a node plugin the development state answers for', () => {
    const result = pluginState(bridge({
      roster, installed: [installed('folder'), installed('client', { hasNode: false })],
      development: { folder: { on: true, reloadedAt: 5 }, client: { on: false } },
    }))
    expect(row(result, 'folder')).toMatchObject({ state: 'active', development: { on: true, reloadedAt: 5 } })
    expect(row(result, 'client')?.development).toBeUndefined()
  })

  it('shows a reload the loader refused as a failed load, while the old version keeps serving', () => {
    const result = pluginState(bridge({
      roster, installed: [installed('folder')], development: { folder: { on: true, failure: { reason: 'SyntaxError in dist/node.js', at: 9 } } },
    }))
    expect(row(result, 'folder')).toMatchObject({ state: 'failed', stage: 'load', failedAt: 9, reason: 'SyntaxError in dist/node.js', running: true })
    expect(row(result, 'folder')?.development).toEqual({ on: true })
  })
})
