import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { PluginKeyClaimGrant } from '@acorn/protocol/api.ts'
import { activeNodeId } from '../node/activeNode'
import { nodes } from '../node/fleet'
import { installedByNode } from '../plugins/distribution'
import { keyClaimGrants } from '../plugins/permissions'
import { prefsOptions } from '../queries'
import { eventChord, formatChord } from '../tasks/paneShortcuts'
import {
  keybindingConflict,
  keybindingRegistry,
  readKeybindingOverrides,
  readLegacyPaneOverrides,
  resolveKeybindings,
  type KeybindingContribution,
  type ResolvedKeybinding,
} from '../registries/keybindings'
import { saveJsonPref } from './savePref'
import { PrefKeys } from '../persistence/prefKeys'
import { orphanedPluginOverrideIds, removeOverrideIds, visibleShortcutBindings } from './shortcutSettingsModel'
import { Alert } from '../ui/primitives'

type ShortcutGroup = {
  key: string
  label: string
  pluginId?: string
  disabled: boolean
  bindings: ResolvedKeybinding[]
  claims: PluginKeyClaimGrant[]
}

export default function ShortcutsSettings() {
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const [error, setError] = createSignal('')
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
        label: binding.category,
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
      map.set(key, { key, label: pluginId, pluginId, disabled: !row?.running, bindings: [], claims: pluginClaims })
    }
    return [...map.values()]
  })

  const saveOverrides = (next: Record<string, string | null>) =>
    saveJsonPref(queryClient, PrefKeys.keybindings, next)

  const saveOverride = async (binding: KeybindingContribution, chord: string | null) => {
    await saveOverrides({ ...overrides(), [binding.id]: chord })
  }

  const resetBindings = async (bindings: readonly KeybindingContribution[]) => {
    const ids = bindings.map((binding) => binding.id)
    const legacyIds = new Set(bindings.flatMap((binding) => binding.legacyPaneAction ?? []))
    const legacy = readLegacyPaneOverrides(prefs.data?.[PrefKeys.paneShortcuts])
    setError('')
    await Promise.all([
      saveOverrides(removeOverrideIds(overrides(), ids)),
      saveJsonPref(queryClient, PrefKeys.paneShortcuts, removeOverrideIds(legacy, legacyIds)),
    ])
  }

  const captureKey = (binding: KeybindingContribution, event: KeyboardEvent) => {
    event.preventDefault()
    const input = event.currentTarget as HTMLElement
    if (event.key === 'Escape' || event.key === 'Tab') return input.blur()
    const chord = eventChord(event)
    if (!chord) return
    const conflict = keybindingConflict(binding.id, chord, contributions(), prefs.data ?? {})
    if (conflict) return setError(`${formatChord(chord)} is already used by ${conflict.conflict}`)
    setError('')
    void saveOverride(binding, chord)
    input.blur()
  }

  return (
    <>
      <p class="muted">Click a chord, then press its replacement. Conflicts never steal an existing binding.</p>
      <Show when={error()}><Alert>{error()}</Alert></Show>
      <For each={groups()}>
        {(group) => (
          <section class="shortcut-group" classList={{ 'shortcut-group-disabled': group.disabled }}>
            <div class="settings-section-label shortcut-group-heading">
              <span>{group.label}<Show when={group.pluginId}> · {nodeLabel()}</Show></span>
              <Show when={group.bindings.length}>
                <button type="button" class="shortcut-reset" onClick={() => void resetBindings(group.bindings)}>Reset section</button>
              </Show>
            </div>
            <Show when={group.disabled}><p class="shortcut-plugin-state muted">Plugin disabled — shortcuts remain editable and will apply when it is enabled.</p></Show>
            {/* Stays a plain <dl>: `.help-list` aligns its two columns ACROSS rows, which
                DescriptionList.Item cannot express — each Item is its own grid. */}
            <dl class="help-list">
              <For each={group.bindings}>
                {(binding) => (
                  <>
                    <dt>
                      <input
                        type="text"
                        class="help-key shortcut-input"
                        classList={{ 'shortcut-conflict': !!binding.conflict }}
                        readonly
                        value={binding.chord ? formatChord(binding.chord) : 'Unbound'}
                        onKeyDown={(event) => captureKey(binding, event)}
                        aria-label={`Shortcut for ${binding.description}`}
                      />
                    </dt>
                    <dd class="help-desc">
                      {binding.description}
                      {/* Sits mid-sentence inside the description, so it keeps inline flow — the one
                          `.action-error` site that was not a standalone message. */}
                      <Show when={binding.conflict}><Alert class="shortcut-conflict-note"> · conflicts with {binding.conflict}</Alert></Show>
                      <button type="button" class="shortcut-reset" aria-label={`Unbind ${binding.description}`} onClick={() => void saveOverride(binding, null)}>×</button>
                      <button type="button" class="shortcut-reset" onClick={() => void resetBindings([binding])}>Reset</button>
                    </dd>
                  </>
                )}
              </For>
            </dl>
            <Show when={group.claims.length}>
              <div class="shortcut-claims muted">
                <For each={group.claims}>{(claim) => <div>Handled by the {claim.label} surface: {claim.chords.map(formatChord).join(', ')}</div>}</For>
              </div>
            </Show>
          </section>
        )}
      </For>
      <Show when={orphaned().length}>
        <div class="settings-actions shortcut-cleanup">
          <button type="button" class="ui-btn" onClick={() => void saveOverrides(removeOverrideIds(overrides(), orphaned()))}>
            Remove settings for plugins that are no longer installed ({orphaned().length})
          </button>
        </div>
      </Show>
    </>
  )
}
