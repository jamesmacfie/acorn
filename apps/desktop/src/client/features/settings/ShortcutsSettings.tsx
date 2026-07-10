import { createMemo, createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '../../queries'
import { eventChord, formatChord } from '../tasks/paneShortcuts'
import {
  keybindingConflict,
  keybindingRegistry,
  readKeybindingOverrides,
  resolveKeybindings,
  type KeybindingContribution,
} from '../../registries/keybindings'
import { savePref } from './savePref'

export default function ShortcutsSettings() {
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const [error, setError] = createSignal('')
  const resolved = createMemo(() => resolveKeybindings(keybindingRegistry.entries(), prefs.data ?? {}))
  const categories = createMemo(() => [...new Set(resolved().map((binding) => binding.category))])

  const saveOverride = async (binding: KeybindingContribution, chord: string) => {
    const overrides = readKeybindingOverrides(prefs.data?.keybindings)
    await savePref(queryClient, 'keybindings', JSON.stringify({ ...overrides, [binding.id]: chord }))
  }

  const captureKey = (binding: KeybindingContribution, event: KeyboardEvent) => {
    event.preventDefault()
    const input = event.currentTarget as HTMLElement
    if (event.key === 'Escape' || event.key === 'Tab') return input.blur()
    const chord = eventChord(event)
    if (!chord) return
    const conflict = keybindingConflict(binding.id, chord, keybindingRegistry.entries(), prefs.data ?? {})
    if (conflict) return setError(`${formatChord(chord)} is already used by ${conflict.conflict}`)
    setError('')
    void saveOverride(binding, chord)
    input.blur()
  }

  return (
    <>
      <p class="muted">Click a chord, then press its replacement. Conflicts never steal an existing binding.</p>
      <Show when={error()}><div class="action-error" role="alert">{error()}</div></Show>
      <For each={categories()}>
        {(category) => (
          <>
            <div class="settings-section-label">{category}</div>
            <dl class="help-list">
              <For each={resolved().filter((binding) => binding.category === category)}>
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
                    <dd class="help-desc" classList={{ muted: binding.active ? !binding.active() : false }}>
                      {binding.description}
                      <Show when={binding.conflict}><span class="action-error"> · conflicts with {binding.conflict}</span></Show>
                      <button type="button" class="shortcut-reset" onClick={() => void saveOverride(binding, binding.defaultChord)}>Reset</button>
                    </dd>
                  </>
                )}
              </For>
            </dl>
          </>
        )}
      </For>
      <div class="settings-actions">
        <button
          type="button"
          class="overlay-btn"
          onClick={() => {
            setError('')
            void savePref(queryClient, 'keybindings', '{}')
            void savePref(queryClient, 'pane_shortcuts', '{}')
          }}
        >Reset all to defaults</button>
      </div>
    </>
  )
}
