import { describe, expect, it } from 'vitest'
import type { PluginContributions } from '@acorn/protocol/api.ts'
import { isOwnNamespace, namespaceContributions, qualifiedContributionId } from './contributionIds'

// See ./contributionIds.ts for the collision this closes: a future core id losing a first-come race
// to an id an installed plugin already took.

const contributions = (partial: Partial<PluginContributions>): PluginContributions =>
  ({ frames: [], sources: [], slots: [], commands: [], routes: [], contentLinks: [], ...partial }) as PluginContributions

describe('qualifiedContributionId', () => {
  it('leaves every shape the first-party packages already use', () => {
    // The reason this rule cost nothing to introduce: no id that has ever shipped moves, so no saved
    // layout moves either. If one of these ever started failing, someone would need a migration.
    for (const [pluginId, id] of [
      ['database', 'database'],
      ['http', 'http'], ['http', 'http-project'], ['http', 'http-variables'], ['http', 'http-requests'],
      ['linear', 'linear'], ['linear', 'linear-issue'], ['linear', 'linear-ref'], ['linear', 'linear-issues'],
      ['rollbar', 'rollbar'], ['rollbar', 'rollbar-items'],
    ] as const) {
      expect(isOwnNamespace(pluginId, id)).toBe(true)
      expect(qualifiedContributionId(pluginId, id)).toBe(id)
    }
  })

  it('binds anything else to the plugin that declared it', () => {
    expect(qualifiedContributionId('ntfy', 'notes')).toBe('ntfy.notes')
    // Not a substring match: `ntfyx` is a different plugin, and `notes-ntfy` is not inside `ntfy`.
    expect(qualifiedContributionId('ntfy', 'ntfyx-board')).toBe('ntfy.ntfyx-board')
    expect(qualifiedContributionId('ntfy', 'notes-ntfy')).toBe('ntfy.notes-ntfy')
  })
})

describe('namespaceContributions', () => {
  it('rewrites the declaration and every reference to it, in one pass', () => {
    const next = namespaceContributions('ntfy', contributions({
      frames: [{ id: 'notes', target: 'pane', label: 'Notes' }],
      commands: [{ id: 'open', title: 'Open', action: { verb: 'openPane', pane: 'notes' } }],
      routes: [{ surface: 'notes', path: '/p/:projectId/x/ntfy/notes', item: 'projectId' }],
      contentLinks: [{ id: 'link', pane: 'notes' }],
    } as unknown as Partial<PluginContributions>))
    expect(next.frames.map((frame) => frame.id)).toEqual(['ntfy.notes'])
    expect((next.commands![0] as unknown as { action: { pane: string } }).action.pane).toBe('ntfy.notes')
    expect((next.routes![0] as unknown as { surface: string }).surface).toBe('ntfy.notes')
    expect((next.contentLinks![0] as unknown as { pane: string }).pane).toBe('ntfy.notes')
    // The command id is not a surface id and is qualified elsewhere, as `plugin.<id>.<command>`.
    expect(next.commands![0]!.id).toBe('open')
  })

  it('returns the same object when nothing needs binding', () => {
    // The common case today, and it has to stay free: five packages ship and none of them moves.
    const input = contributions({ frames: [{ id: 'ntfy', target: 'pane', label: 'Ntfy' }] } as unknown as Partial<PluginContributions>)
    expect(namespaceContributions('ntfy', input)).toBe(input)
  })

  it('leaves a host slot name alone, and another plugin’s extension point', () => {
    // `slot` names one of the host's own slots and `point` names another plugin's; only `pane`,
    // `surface` and `overlay` are references to something this manifest declared.
    const next = namespaceContributions('ntfy', contributions({
      frames: [{ id: 'notes', target: 'pane', label: 'Notes' }],
      slots: [{ id: 'chip', slot: 'topbar.right' }],
    } as unknown as Partial<PluginContributions>))
    expect(next.slots!.map((entry) => entry.id)).toEqual(['ntfy.chip'])
    expect((next.slots![0] as unknown as { slot: string }).slot).toBe('topbar.right')
  })
})
