import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { PluginKeyClaimGrant } from '@acorn/protocol/api.ts'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodes } from '../../infra/node/fleet'
import { installedByNode } from '../../host/plugins/distribution'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { keyClaimGrants } from '../../host/trust/permissions'
import { prefsOptions } from '../../infra/queries'
import { eventChord, formatChord } from '../tasks/paneShortcuts'
import {
  keybindingConflict,
  keybindingRegistry,
  readKeybindingOverrides,
  resolveKeybindings,
  type KeybindingContribution,
  type ResolvedKeybinding,
} from '../../host/registries/commands/keybindings'
import { savePref } from './savePref'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { orphanedPluginOverrideIds, removeOverrideIds, visibleShortcutBindings } from './shortcutSettingsModel'
import { Alert, Button } from '../../kit/components/primitives'
import { IconButton } from '../../kit/components/inputs/IconButton'
import { Text } from '../../kit/components/content/Text'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { confirmAction } from '../../host/registries/shell/willPhase'
import { createSettingSave, type SettingSave } from './settingSave'

type ShortcutGroup = {
  key: string
  label: string
  pluginId?: string
  disabled: boolean
  bindings: ResolvedKeybinding[]
  claims: PluginKeyClaimGrant[]
}

// A section anchor is one word, and a group key is `core:<category>` or `plugin:<id>` with spaces and
// capitals in it. Plugin groups keep a `plugin.` prefix so a plugin named like a core category cannot
// take its anchor.
const sectionId = (group: ShortcutGroup): string => {
  const word = (text: string) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return group.pluginId ? `plugin.${word(group.pluginId)}` : word(group.label) || 'shortcuts'
}

export default function ShortcutsSettings() {
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  // A chord refused because another binding holds it, said on the row that tried to take it.
  const [refused, setRefused] = createSignal<{ id: string; message: string }>()
  // Save state per binding and per group, held here rather than in the rows. Every write re-resolves
  // the bindings and redraws the groups, so state kept in a row would vanish with the error it holds.
  const saves = new Map<string, SettingSave>()
  const saveFor = (key: string): SettingSave => {
    const existing = saves.get(key)
    if (existing) return existing
    const created = createSettingSave()
    saves.set(key, created)
    return created
  }
  const contributions = () => keybindingRegistry.entries()
  const resolved = createMemo(() => visibleShortcutBindings(resolveKeybindings(contributions(), prefs.data ?? {})))
  const overrides = createMemo(() => readKeybindingOverrides(prefs.data?.[PrefKeys.keybindings]))
  const orphaned = createMemo(() => orphanedPluginOverrideIds(overrides(), contributions()))
  const nodeLabel = createMemo(() => {
    const id = activeNodeId()
    return nodes().find((node) => node.nodeId === id)?.label ?? 'This node'
  })

  const claims = createMemo(() => {
    const id = activeNodeId()
    if (!id) return new Map<string, PluginKeyClaimGrant[]>()
    return new Map(
      (installedByNode().get(id) ?? []).flatMap((row) => {
        if (!row.installed) return []
        const grants = keyClaimGrants(row.installed.contributions)
        return grants.length ? [[row.name, grants] as const] : []
      }),
    )
  })

  const groups = createMemo<ShortcutGroup[]>(() => {
    const map = new Map<string, ShortcutGroup>()
    for (const binding of resolved()) {
      const pluginId = binding.plugin?.id
      const key = pluginId ? `plugin:${pluginId}` : `core:${binding.category}`
      const group = map.get(key) ?? {
        key,
        label: pluginId ? pluginLabel(pluginId) : binding.category,
        ...(pluginId ? { pluginId } : {}),
        disabled: binding.plugin?.state() === 'disabled',
        bindings: [],
        claims: pluginId ? claims().get(pluginId) ?? [] : [],
      }
      group.bindings.push(binding)
      map.set(key, group)
    }
    for (const [pluginId, pluginClaims] of claims()) {
      const key = `plugin:${pluginId}`
      if (map.has(key)) continue
      const row = (installedByNode().get(activeNodeId() ?? '') ?? []).find((candidate) => candidate.name === pluginId)
      map.set(key, { key, label: pluginLabel(pluginId), pluginId, disabled: !row?.running, bindings: [], claims: pluginClaims })
    }
    return [...map.values()]
  })

  // Straight to savePref with `throwOnFailure`, so a failed write is said once, beside the row that
  // made it, rather than on the row and again as a background notice.
  const saveOverrides = (next: Record<string, string | null>) =>
    savePref(queryClient, PrefKeys.keybindings, JSON.stringify(next), { throwOnFailure: true })

  const saveOverride = (binding: KeybindingContribution, chord: string | null) =>
    saveOverrides({ ...overrides(), [binding.id]: chord })

  const resetBindings = (bindings: readonly KeybindingContribution[]) => {
    const ids = bindings.map((binding) => binding.id)
    setRefused(undefined)
    return saveOverrides(removeOverrideIds(overrides(), ids))
  }

  const captureKey = (binding: KeybindingContribution, save: SettingSave, event: KeyboardEvent) => {
    event.preventDefault()
    const input = event.currentTarget as HTMLElement
    if (event.key === 'Escape' || event.key === 'Tab') return input.blur()
    const chord = eventChord(event)
    if (!chord) return
    const conflict = keybindingConflict(binding.id, chord, contributions(), prefs.data ?? {})
    if (conflict) return setRefused({ id: binding.id, message: `${formatChord(chord)} is already used by ${conflict.conflict}` })
    setRefused(undefined)
    void save.run(() => saveOverride(binding, chord))
    input.blur()
  }

  // Only a binding with a stored choice other than its default can go back to it.
  const changed = (binding: KeybindingContribution) =>
    Object.prototype.hasOwnProperty.call(overrides(), binding.id) && overrides()[binding.id] !== binding.defaultChord

  const cleanup = createSettingSave()
  const removeOrphaned = async () => {
    const ids = orphaned()
    const confirmed = await confirmAction({
      title: 'Remove shortcuts for removed plugins',
      actionLabel: 'Remove',
      goes: `The ${ids.length} shortcuts you set for plugins that aren't installed. If you install one again, it starts with its own shortcuts.`,
      stays: 'Your shortcuts for acorn and for every installed plugin.',
      danger: true,
    })
    if (confirmed) void cleanup.run(() => saveOverrides(removeOverrideIds(overrides(), ids)))
  }

  return (
    <>
      <Text emphasis="muted" wrap>To change a shortcut, click it and press the new keys.</Text>
      <For each={groups()}>
        {(group) => {
          const reset = saveFor(`group:${group.key}`)
          return (
            <SettingsSection
              id={sectionId(group)}
              // The node only matters when there is more than one to tell apart.
              label={group.pluginId && nodes().length > 1 ? `${group.label} · ${nodeLabel()}` : group.label}
              description={group.disabled ? 'This plugin is off. Changes here apply when you turn it on.' : undefined}
              actions={
                <Show when={group.bindings.some(changed)}>
                  <Button variant="ghost" size="sm" onPress={() => void reset.run(() => resetBindings(group.bindings))}>Reset section</Button>
                </Show>
              }
            >
              <Show when={reset.error()}>{(message) => <Alert>{message()}</Alert>}</Show>
              <For each={group.bindings}>
                {(binding) => {
                  const save = saveFor(`binding:${binding.id}`)
                  return (
                    <SettingRow
                      label={binding.description}
                      description={binding.conflict ? `Also used by ${binding.conflict}` : undefined}
                      savedAt={save.savedAt()}
                      error={refused()?.id === binding.id ? refused()!.message : save.error()}
                      onReset={changed(binding) ? () => void save.run(() => resetBindings([binding])) : undefined}
                    >
                      {/* A plain read-only input rather than the kit's Input: it captures the next key
                          press as a chord, and `.help-key` draws it as a keycap. */}
                      <input
                        type="text"
                        class="help-key shortcut-input"
                        classList={{ 'shortcut-conflict': !!binding.conflict }}
                        readonly
                        value={binding.chord ? formatChord(binding.chord) : 'Unbound'}
                        // Sized to its chord, so a four-key chord is not clipped.
                        size={Math.max(3, (binding.chord ? formatChord(binding.chord) : 'Unbound').length)}
                        onKeyDown={(event) => captureKey(binding, save, event)}
                        aria-label={`Shortcut for ${binding.description}`}
                      />
                      <IconButton icon="x" label={`Unbind ${binding.description}`} onPress={() => void save.run(() => saveOverride(binding, null))} />
                    </SettingRow>
                  )
                }}
              </For>
              <Show when={group.claims.length}>
                <div class="shortcut-claims">
                  <For each={group.claims}>
                    {(claim) => <Text emphasis="muted" wrap>{claim.label} uses these keys itself: {claim.chords.map(formatChord).join(', ')}</Text>}
                  </For>
                </div>
              </Show>
            </SettingsSection>
          )
        }}
      </For>
      <Show when={orphaned().length}>
        <SettingsSection id="danger" label="Removed plugins" tone="danger">
          <SettingRow
            label="Shortcuts for removed plugins"
            description={`${orphaned().length} shortcuts you set are for plugins that aren't installed anymore.`}
            error={cleanup.error()}
          >
            <Button tone="danger" onPress={() => void removeOrphaned()}>Remove</Button>
          </SettingRow>
        </SettingsSection>
      </Show>
    </>
  )
}
