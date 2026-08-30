import { For, Show, createMemo } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { Badge, Field, SectionHeader, Select } from '../ui/primitives'
import { PrefKeys } from '../infra/persistence/prefKeys'
import { prefsOptions } from '../infra/queries'
import { savePref } from './savePref'
import {
  extensionDeliveries,
  extensionPointRegistry,
  unmatchedExtensions,
} from '../registries/extensionPoints'
import { slotChoices, withSlotChoice } from '../plugins/tree/arbitration'

// Every extension point on this node, who fills it, and every contribution that fills nothing
// (docs/plugins.md § Seeing what matched).
//
// An unmatched contribution is silent by design: a point whose owner is missing, disabled, untrusted on
// this device or renamed simply has nothing delivered into it, and nothing throws. That is right for a
// user and the worst possible thing for an author, because a typo in `point` produces an empty pane and
// no error. This screen is the other half of that decision.
//
// It reads the same registries the hosts read and adds no bridge verb, so it can never disagree with
// what is actually on screen.

const KIND_HELP: Record<string, string> = {
  rows: 'other plugins’ rows, under this pane',
  annotation: 'marks other plugins put on this pane’s items',
  remote: 'UI another plugin draws inside this one',
  rectangle: 'a box beside this pane, holding another plugin’s page',
  hook: 'a turn other plugins take before this one acts',
}

export default function ExtensionPointsDev() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const points = createMemo(() =>
    [...extensionPointRegistry.entries()].sort((a, b) => a.id.localeCompare(b.id)))
  const unmatched = createMemo(() => unmatchedExtensions())

  return (
    <div>
      <p class="muted">
        What each plugin has opened to the others, and who has taken it up. A contribution that matches
        nothing is silent everywhere else in acorn, so this is where it shows.
      </p>

      <SectionHeader level="group">Points on this node</SectionHeader>
      <Show when={points().length} fallback={<p class="muted">No plugin here has opened a point.</p>}>
        <ul class="plugin-point-list">
          <For each={points()}>
            {(point) => {
              const filled = () => extensionDeliveries(point.id)
              const stored = () => prefs.data?.[PrefKeys.remoteSlots]
              // A `replace` point with more than one taker draws the owner's default until somebody
              // decides. The picker is the deciding, and it is the same control the exclusive slots use
              // for the same reason: an override is an offer, not a seizure.
              const tied = () => (point.mode === 'replace' && filled().length > 1 ? filled() : [])
              return (
                <li class="plugin-point">
                  <span class="plugin-point-id">{point.id}</span>
                  <Badge>{point.kind}</Badge>
                  <Show when={point.mode}>{(mode) => <Badge>{mode()}</Badge>}</Show>
                  <span class="muted">{KIND_HELP[point.kind] ?? point.label}</span>
                  <Show
                    when={filled().length}
                    fallback={<span class="muted">nobody fills it</span>}
                  >
                    <span class="muted">
                      filled by {filled().map((entry) => entry.pluginId).join(', ')}
                    </span>
                  </Show>
                  <Show when={tied().length}>
                    <Field label="Which plugin draws this">
                      <Select
                        value={slotChoices(stored())[point.id] ?? ''}
                        options={[
                          { value: '', label: `${point.ownerId}’s own` },
                          ...tied().map((entry) => ({ value: entry.pluginId, label: `${entry.label} (${entry.pluginId})` })),
                        ]}
                        onChange={(value) =>
                          // Point-wide, not per key: this screen lists points, and "who draws this
                          // slot" is the decision a person is here to make. A slot resolves the
                          // per-key answer first and falls back to this one.
                          void savePref(qc, PrefKeys.remoteSlots, withSlotChoice(stored(), point.id, value))}
                      />
                    </Field>
                  </Show>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>

      <SectionHeader level="group">Contributions that match nothing</SectionHeader>
      <Show
        when={unmatched().length}
        fallback={<p class="muted">Everything contributed here has somewhere to go.</p>}
      >
        <ul class="plugin-point-list">
          <For each={unmatched()}>
            {(miss) => (
              <li class="plugin-point">
                <span class="plugin-point-id">{miss.entry.pluginId} → {miss.entry.point}</span>
                <span class="muted">{miss.reason}</span>
                <Show when={miss.suggestion}>
                  {(suggestion) => <span class="muted">did you mean {suggestion()}?</span>}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
