import { afterEach, describe, expect, it } from 'vitest'
import { PLUGIN_API_MAJOR, type NodePluginRow, type PluginContributions, type PluginFrameSurface } from '@acorn/protocol/api.ts'
import { declaredSurfaces, eligiblePlugins, hasWithheldCode, isTaskPane } from './contributions'
import { _resetPluginDistribution, _seedPluginDistribution } from './distribution'

// The questions that used to be answered twice, once in each register module. Both callers are plain
// `.ts` and have their own suites now (chrome/register.test.ts, frames/register.test.ts); this one
// pins the shared answer they both start from.

const HASH = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

const surface = (over: Partial<PluginFrameSurface> & Pick<PluginFrameSurface, 'id' | 'target'>): PluginFrameSurface => ({
  label: over.id,
  glyph: 'puzzle',
  order: 500,
  formFactor: ['desktop'],
  ...over,
})

const row = (name: string, over: Partial<NodePluginRow['installed']> = {}, frames: PluginFrameSurface[] = []): NodePluginRow => ({
  name,
  required: false,
  disabled: false,
  running: true,
  state: 'active',
  installed: {
    version: '1.0.0',
    // The real constant, not '1': the literal made every fixture here a candidate this shell could not
    // speak the day PLUGIN_API_MAJOR moved, and the failure looked like a bug in resolution.
    apiVersion: PLUGIN_API_MAJOR,
    permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } },
    contributions: { frames } as PluginContributions,
    client: null,
    ...over,
  },
})

afterEach(() => _resetPluginDistribution())

describe('eligiblePlugins', () => {
  it('skips a roster row with no manifest, and takes the first node offering an id', () => {
    _seedPluginDistribution([
      ['node-a', [{ name: 'terminal', required: true, disabled: false, running: true, state: 'active' }, row('board')]],
      ['node-b', [row('board', { version: '2.0.0' })]],
    ])
    const eligible = eligiblePlugins()
    expect(eligible.map((entry) => entry.pluginId)).toEqual(['board'])
    expect(eligible[0]!.installed.version).toBe('1.0.0')
  })

  it('never marks a package with no client half as trusted, but withholds nothing from it', () => {
    // Two answers, not one, and collapsing them is what let a bundle-less manifest mount a webview.
    // `trusted` is "may this device EXECUTE this plugin's code", and the answer for a package with no
    // code is no — a webview surface is not host-drawn, so `trusted: true` here would mount external
    // web content behind a prompt that can never fire (the trust queue only holds bundles).
    // `hasWithheldCode` is the weaker question the chrome pass asks, and the answer there is also no:
    // there are no bytes being withheld, so its descriptors must still contribute.
    _seedPluginDistribution([['node-a', [row('board')]]])
    const entry = eligiblePlugins()[0]!
    expect(entry).toMatchObject({ trusted: false, hash: '' })
    expect(hasWithheldCode(entry)).toBe(false)
  })

  it('withholds a bundle-less package that declares a webview from the frame pass', () => {
    // The regression this pair exists for. A manifest may legally declare `target: 'webview'` with no
    // client entry, and nothing about that package ever reaches the trust dialog.
    _seedPluginDistribution([[
      'node-a',
      [row('board', {}, [surface({ id: 'docs', target: 'webview', hosts: ['docs.example.com'], url: 'https://docs.example.com' })])],
    ]])
    // frames/register.ts registers a non-host-owned surface only when this is true.
    expect(eligiblePlugins()[0]!.trusted).toBe(false)
  })

  it('does not let a stale acceptance clear a bundle that lost resolution', () => {
    // The apiVersion bump case. resolveBundles drops a candidate this shell cannot speak, so there is
    // no runnable bundle — but the roster row still carries its `client.hash`, and an acceptance
    // recorded against those bytes in an older shell is still on file. Falling back to the row's own
    // claimed hash would mark it trusted and mount a bundle that was never re-fetched.
    _seedPluginDistribution(
      [['node-a', [row('board', { apiVersion: '99', client: { hash: HASH, bytes: 12 } })]]],
      [`board ${HASH}`],
    )
    const entry = eligiblePlugins()[0]!
    expect(entry).toMatchObject({ trusted: false, hash: '' })
    // And chrome withholds it too: its descriptors are click sites for code that cannot run.
    expect(hasWithheldCode(entry)).toBe(true)
  })

  it('takes manifest, hash and trust from the row whose bundle won resolution', () => {
    // A mixed-version fleet. Node A offers v1 first and node B's v2 wins resolution, so the manifest
    // registered has to be v2's — taking v1's contributions while trusting v2's bytes means drawing
    // surfaces declared by bytes nobody accepted.
    _seedPluginDistribution(
      [
        ['node-a', [row('board', { version: '1.0.0', client: { hash: HASH, bytes: 12 } }, [surface({ id: 'old', target: 'pane' })])]],
        ['node-b', [row('board', { version: '2.0.0', client: { hash: HASH_B, bytes: 12 } }, [surface({ id: 'new', target: 'pane' })])]],
      ],
      [`board ${HASH_B}`],
    )
    const entry = eligiblePlugins()[0]!
    expect(entry).toMatchObject({ hash: HASH_B, trusted: true })
    expect(entry.installed.version).toBe('2.0.0')
    expect(entry.installed.contributions.frames.map((frame) => frame.id)).toEqual(['new'])
  })

  it('withholds the winner when only the LOSING bundle was ever accepted', () => {
    // The other half of the same fleet: an acceptance on file for v1's bytes says nothing about v2's.
    _seedPluginDistribution(
      [
        ['node-a', [row('board', { version: '1.0.0', client: { hash: HASH, bytes: 12 } })]],
        ['node-b', [row('board', { version: '2.0.0', client: { hash: HASH_B, bytes: 12 } })]],
      ],
      [`board ${HASH}`],
    )
    const entry = eligiblePlugins()[0]!
    expect(entry).toMatchObject({ hash: HASH_B, trusted: false })
    expect(hasWithheldCode(entry)).toBe(true)
  })

  it('marks a bundle the owner has not accepted as untrusted, without dropping the row', () => {
    _seedPluginDistribution([['node-a', [row('board', { client: { hash: HASH, bytes: 12 } })]]])
    const entry = eligiblePlugins()[0]!
    expect(entry).toMatchObject({ pluginId: 'board', trusted: false, hash: HASH })
    expect(hasWithheldCode(entry)).toBe(true)
  })

  it('marks an accepted bundle trusted', () => {
    _seedPluginDistribution([['node-a', [row('board', { client: { hash: HASH, bytes: 12 } })]]], [`board ${HASH}`])
    const entry = eligiblePlugins()[0]!
    expect(entry).toMatchObject({ trusted: true, hash: HASH })
    expect(hasWithheldCode(entry)).toBe(false)
  })

  it('withdraws trust when a reload moves the winning hash to bytes nobody accepted', () => {
    // The reload path re-pins `activeBundles` when the node says its plugin set changed
    // (plugins/reload.ts), and this is the reason that cannot be a silent activation: consent was given
    // to a HASH, so the new bundle arrives untrusted and its code-bearing surfaces are withheld until
    // the owner answers the prompt the distribution pass queues for it.
    _seedPluginDistribution([['node-a', [row('board', { client: { hash: HASH, bytes: 12 } })]]], [`board ${HASH}`])
    expect(eligiblePlugins()[0]).toMatchObject({ trusted: true })

    _seedPluginDistribution([['node-a', [row('board', { client: { hash: HASH_B, bytes: 12 } })]]], [`board ${HASH}`])
    const entry = eligiblePlugins()[0]!
    expect(entry).toMatchObject({ hash: HASH_B, trusted: false })
    expect(hasWithheldCode(entry)).toBe(true)
  })

  it('is the same answer for a dev grant: an acceptance is an acceptance, and losing it withholds code', () => {
    // The dev grant does not change eligibility, and that is the design (docs/security.md § The dev
    // grant). It writes an ordinary accepted acknowledgement in main as the bytes land, so the new hash
    // arrives here already trusted and no prompt is queued for it — and ending dev mode DELETES those
    // acknowledgements, which is what makes "revoke" mean something on this side of the seam.
    _seedPluginDistribution([['node-a', [row('board', { client: { hash: HASH_B, bytes: 12 } })]]], [`board ${HASH_B}`])
    expect(eligiblePlugins()[0]).toMatchObject({ hash: HASH_B, trusted: true })

    // After the revoke: the grant dropped every ack it wrote, so the same bundle is undecided again.
    _seedPluginDistribution([['node-a', [row('board', { client: { hash: HASH_B, bytes: 12 } })]]], [])
    const revoked = eligiblePlugins()[0]!
    expect(revoked).toMatchObject({ hash: HASH_B, trusted: false })
    expect(hasWithheldCode(revoked)).toBe(true)
  })
})

describe('isTaskPane', () => {
  // The `openPane` allowlist — which pane ids a sandboxed frame may ask the host to open — is built
  // from this predicate on both sides of the frames/chrome split. It was copy-paste until now.
  it('counts task panes and webviews, and nothing else', () => {
    expect(isTaskPane({ target: 'pane' })).toBe(true)
    expect(isTaskPane({ target: 'pane', scope: 'task' })).toBe(true)
    // A webview is a pane by another name and has no second scope.
    expect(isTaskPane({ target: 'webview' })).toBe(true)
    expect(isTaskPane({ target: 'pane', scope: 'project' })).toBe(false)
    expect(isTaskPane({ target: 'overlay' })).toBe(false)
    expect(isTaskPane({ target: 'refPanel' })).toBe(false)
    expect(isTaskPane({ target: 'settings' })).toBe(false)
    expect(isTaskPane({ target: 'importer' })).toBe(false)
  })
})

describe('declaredSurfaces', () => {
  it('keeps the three sets disjoint', () => {
    const surfaces = declaredSurfaces({
      frames: [
        surface({ id: 'board', target: 'pane' }),
        surface({ id: 'board-browse', target: 'pane', scope: 'project' }),
        surface({ id: 'board-picker', target: 'overlay' }),
        surface({ id: 'board-web', target: 'webview' }),
        surface({ id: 'board-settings', target: 'settings' }),
      ],
    } as PluginContributions)
    expect([...surfaces.panes].sort()).toEqual(['board', 'board-web'])
    expect([...surfaces.projectPanes]).toEqual(['board-browse'])
    expect([...surfaces.overlays]).toEqual(['board-picker'])
  })

  it('answers empty for a manifest that declares no frames', () => {
    const surfaces = declaredSurfaces({} as PluginContributions)
    expect([surfaces.panes.size, surfaces.projectPanes.size, surfaces.overlays.size]).toEqual([0, 0, 0])
  })
})
