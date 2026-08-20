import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_API_MAJOR, type NodePluginPermissions, type NodePluginRow, type PluginContributions } from '@acorn/protocol/api.ts'
import type { PluginAckRecord } from '../platform'

const recordPluginTrust = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('./host', () => ({
  recordPluginTrust: (...args: unknown[]) => recordPluginTrust(...args),
  pluginHostAvailable: () => true,
  readPluginHostState: async () => ({ cached: {}, acks: [] }),
  cachePluginBundle: async () => ({ error: 'unreachable' }),
}))

const syncPluginContributions = vi.fn()
vi.mock('./syncContributions', () => ({ syncPluginContributions: () => syncPluginContributions() }))

vi.mock('../apiClient', () => ({ readJson: vi.fn(), sendRaw: vi.fn(), writeJson: vi.fn() }))

const { bundleAccepted, pendingTrust, _resetPluginDistribution, _seedPendingTrust } = await import('./distribution')
const { recordTrustDecision, trustTiers } = await import('./trustModel')

// What the trust prompt says, and what answering it does (PluginTrustDialog.tsx draws it).
//
// The tier split is a security claim rather than a layout: `Enforced` is a fence the UI bridge holds,
// `Declared` is a disclosure the plugin can ignore entirely, and merging them would let the strong
// half lend credibility to the weak one (docs/security.md § Design rules, rule 6).

const HASH = 'a'.repeat(64)

const permissions = (over: Partial<NodePluginPermissions> = {}): NodePluginPermissions => ({
  api: [],
  events: [],
  node: { core: [], capabilities: [], secrets: false, exec: false, net: [] },
  ...over,
})

const request = (over: {
  permissions?: NodePluginPermissions
  contributions?: Partial<PluginContributions>
  previous?: Partial<PluginAckRecord>
  version?: string
} = {}) => ({
  row: {
    name: 'board',
    required: false,
    disabled: false,
    running: true,
    state: 'active',
    installed: {
      version: over.version ?? '2.0.0',
      apiVersion: PLUGIN_API_MAJOR,
      permissions: over.permissions ?? permissions(),
      contributions: { frames: [], ...over.contributions },
      client: { hash: HASH, bytes: 12 },
    },
  } as NodePluginRow,
  hash: HASH,
  nodeId: 'node-a',
  ...(over.previous
    ? {
      previous: {
        pluginId: 'board',
        hash: 'b'.repeat(64),
        nodeId: 'node-a',
        version: '1.0.0',
        decision: 'accepted' as const,
        decidedAt: 1,
        permissions: permissions(),
        webviews: [],
        keyClaims: [],
        extensions: [],
        ...over.previous,
      } as PluginAckRecord,
    }
    : {}),
})

const keysIn = (tiers: ReturnType<typeof trustTiers>, tier: string) =>
  tiers.find((entry) => entry.key === tier)?.lines.map((line) => line.key) ?? []

beforeEach(() => {
  recordPluginTrust.mockClear()
  syncPluginContributions.mockClear()
})

afterEach(() => {
  _resetPluginDistribution()
})

describe('trustTiers', () => {
  it('has nothing to say about a row with no manifest', () => {
    expect(trustTiers(undefined)).toEqual([])
  })

  it('discloses cross-plugin reach in both directions, and a core-surface offer', () => {
    // Both directions is the requirement rather than a nicety. The owner of the extending package must
    // see whose surface its rows land in; the owner of the extended package must see that it opened a
    // door. Neither is inferable from the other side's manifest at trust time (they are two installs,
    // possibly weeks apart), so each manifest discloses its own half.
    //
    // Under `enforced`, and that is a claim about what the host does: it delivers only to points a
    // manifest declared, draws only descriptor shapes it knows, and never puts a replacement on screen
    // the owner did not pick. None of it depends on the plugin behaving.
    const tiers = trustTiers(request({
      contributions: {
        frames: [
          { target: 'pane', id: 'board', label: 'Board', glyph: 'puzzle', order: 500, formFactor: ['desktop'] },
          { target: 'coreSlot', id: 'board-rail', label: 'Board task list', glyph: 'puzzle', order: 500, formFactor: ['desktop'], coreSlot: 'rail.taskList' },
        ],
        extensionPoints: [{ id: 'card-links', label: 'Linked items', location: 'pane.footer', surface: 'board' }],
        extensions: [{ id: 'tracker-rows', point: 'tracker:issues', label: 'Board cards', order: 500, items: '/v2/p/board/rows' }],
      },
    }))
    expect(keysIn(tiers, 'enforced')).toEqual([
      'extension:extends:tracker:issues',
      'extension:hosts:board:card-links',
      'extension:replaces:rail.taskList',
    ])
    const texts = tiers.find((tier) => tier.key === 'enforced')!.lines.map((line) => line.text)
    // The package this one reaches into is named in the sentence, not just in the key.
    expect(texts[0]).toContain('tracker')
    expect(texts[1]).toContain('Linked items')
    expect(texts[2]).toContain('Settings')
  })

  it('marks a version that starts reaching into a different plugin as newly requested', () => {
    // The whole reason the grants are recorded as well as shown. A constant key, or no key at all,
    // would let a package quietly change which plugin it reaches into between versions, which is the
    // one growth an owner has least ability to reason about.
    const tiers = trustTiers(request({
      contributions: {
        extensions: [{ id: 'rows', point: 'linear:issues', label: 'Board cards', order: 500, items: '/v2/p/board/rows' }],
      },
      previous: { extensions: [{ kind: 'extends', target: 'tracker:issues', label: 'Board cards' }] },
    }))
    const enforced = tiers.find((tier) => tier.key === 'enforced')!.lines
    expect(enforced.map((line) => [line.key, line.added])).toEqual([['extension:extends:linear:issues', true]])
  })

  it('keeps the enforced, declared and web claims in three separate lists', () => {
    // They may never be rendered as one: `Enforced` is checked by the UI bridge, `Declared` is the
    // plugin's own description of code that shares the node's process, and `Web pages` reaches the
    // live internet. A reader who cannot tell them apart is being misled about the first one.
    const tiers = trustTiers(request({
      permissions: permissions({ api: ['core.tasks:read'], node: { core: ['git'], capabilities: [], secrets: true, exec: false, net: [] } }),
      contributions: {
        frames: [{
          target: 'webview', id: 'board-web', label: 'Board', glyph: 'puzzle', order: 500,
          formFactor: ['desktop'], url: 'https://board.example/', hosts: ['board.example'],
          claimsKeys: ['meta+shift+b'],
        }],
      },
    }))
    expect(tiers.map((tier) => tier.key)).toEqual(['enforced', 'declared', 'web'])
    expect(keysIn(tiers, 'enforced')).toEqual(['core.tasks:read', 'keys:board-web:meta+shift+b'])
    expect(keysIn(tiers, 'declared')).toEqual(['node.secrets', 'node.core:git'])
    expect(keysIn(tiers, 'web')).toEqual(['webview:board-web:board.example'])
  })

  it('marks nothing as new on a first install', () => {
    const tiers = trustTiers(request({ permissions: permissions({ api: ['core.tasks:read'] }) }))
    expect(tiers.flatMap((tier) => tier.lines).every((line) => !line.added)).toBe(true)
  })

  it('flags only what the last approved version did not have', () => {
    const tiers = trustTiers(request({
      permissions: permissions({ api: ['core.tasks:read', 'core.tasks:write'] }),
      previous: { permissions: permissions({ api: ['core.tasks:read'] }) },
    }))
    expect(tiers.flatMap((tier) => tier.lines).filter((line) => line.added).map((line) => line.key))
      .toEqual(['core.tasks:write'])
  })

  it('diffs the grant key, so rewording a sentence is not a fleet-wide “asks for more”', () => {
    // The whole reason PermissionLine carries a key at all. A copy edit that read as a new grant would
    // teach every owner in a fleet that the "asks for more" banner means nothing.
    const same = permissions({ api: ['core.tasks:read'], node: { core: ['git'], capabilities: [], secrets: false, exec: false, net: [] } })
    const tiers = trustTiers(request({ permissions: same, previous: { permissions: same } }))
    expect(tiers.flatMap((tier) => tier.lines).filter((line) => line.added)).toEqual([])
  })

  it('treats a key claim the previous version lacked as new', () => {
    const claims: Partial<PluginContributions> = {
      frames: [{
        target: 'pane', id: 'board-pane', label: 'Board', glyph: 'puzzle', order: 500,
        formFactor: ['desktop'], claimsKeys: ['meta+shift+b'],
      }],
    }
    const tiers = trustTiers(request({ contributions: claims, previous: { keyClaims: [] } }))
    expect(keysIn(tiers, 'enforced')).toEqual(['keys:board-pane:meta+shift+b'])
    expect(tiers.flatMap((tier) => tier.lines).filter((line) => line.added).map((line) => line.key)).toEqual(['keys:board-pane:meta+shift+b'])
  })
})

describe('recordTrustDecision', () => {
  it('records an acceptance against the bytes and lets the surfaces appear at once', async () => {
    const current = request()
    _seedPendingTrust([current])
    await recordTrustDecision(current, 'accepted')
    expect(recordPluginTrust).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'board', hash: HASH, nodeId: 'node-a', version: '2.0.0', decision: 'accepted',
    }))
    // The projection catches up so a just-accepted plugin's surfaces do not wait for the next boot.
    expect(bundleAccepted('board', HASH)).toBe(true)
    expect(syncPluginContributions).toHaveBeenCalledTimes(1)
    expect(pendingTrust()).toEqual([])
  })

  it('records a rejection and registers nothing', async () => {
    const current = request()
    _seedPendingTrust([current])
    await recordTrustDecision(current, 'rejected')
    expect(recordPluginTrust).toHaveBeenCalledWith(expect.objectContaining({ decision: 'rejected' }))
    expect(bundleAccepted('board', HASH)).toBe(false)
    // Nothing was registered, so there is nothing to take away.
    expect(syncPluginContributions).not.toHaveBeenCalled()
    expect(pendingTrust()).toEqual([])
  })

  it('leaves the queue entry alone when the host could not store the answer', async () => {
    // A decision that was not written down must come back at the next boot, not be silently dropped.
    recordPluginTrust.mockRejectedValueOnce(new Error('no host'))
    const current = request()
    _seedPendingTrust([current])
    await expect(recordTrustDecision(current, 'accepted')).rejects.toThrow('no host')
    expect(pendingTrust()).toHaveLength(1)
    expect(bundleAccepted('board', HASH)).toBe(false)
  })
})
