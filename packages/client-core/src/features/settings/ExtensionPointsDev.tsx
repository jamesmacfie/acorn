import { For, Show, createMemo } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { Badge, EmptyState, Select } from '../../kit/components/primitives'
import { Text } from '../../kit/components/content/Text'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { createSettingSave } from './settingSave'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { prefsOptions } from '../../infra/queries'
import { savePref } from './savePref'
import {
  extensionDeliveries,
  extensionPointRegistry,
  unmatchedExtensions,
} from '../../host/registries/extensionPoints/extensionPoints'
import { slotChoices, withSlotChoice } from '../../host/tree/arbitration'

// Every extension point on this node, who fills it, and every contribution that fills nothing
// (docs/plugins/cooperative-extension-points.md § Seeing what matched).
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

/** The registries' phrases start lowercase, because they used to run on from the id. On a line of
 *  their own they read as sentences. */
const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`

export default function ExtensionPointsDev() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const points = createMemo(() =>
    [...extensionPointRegistry.entries()].sort((a, b) => a.id.localeCompare(b.id)))
  const unmatched = createMemo(() => unmatchedExtensions())

  return (
    <>
      <SettingsSection
        id="points"
        label="Available points"
        help="Places where a plugin lets other plugins add to it, and which plugins do."
      >
        <Show when={points().length} fallback={<EmptyState align="start" size="sm">No plugin offers an extension point.</EmptyState>}>
          <ul class="plugin-point-list">
            <For each={points()}>
              {(point) => {
                const filled = () => extensionDeliveries(point.id)
                const stored = () => prefs.data?.[PrefKeys.remoteSlots]
                // A `replace` point with more than one taker draws the owner's default until somebody
                // decides. The picker is the deciding, and it is the same control the exclusive slots use
                // for the same reason: an override is an offer, not a seizure.
                const tied = () => (point.mode === 'replace' && filled().length > 1 ? filled() : [])
                const save = createSettingSave()
                return (
                  <li class="plugin-point">
                    {/* Two lines: the id and its badges, then what it is and who uses it, so the parts
                        do not run together into one false sentence. */}
                    <span class="plugin-point-head">
                      <span class="plugin-point-id">{point.id}</span>
                      <Badge>{point.kind}</Badge>
                      <Show when={point.mode}>{(mode) => <Badge>{mode()}</Badge>}</Show>
                    </span>
                    <Text emphasis="muted" wrap>
                      {sentence(KIND_HELP[point.kind] ?? point.label)}{' '}
                      {filled().length ? `Used by ${filled().map((entry) => pluginLabel(entry.pluginId)).join(', ')}.` : 'Not used.'}
                    </Text>
                    <Show when={tied().length}>
                      <SettingRow label="Which plugin draws this" error={save.error()}>
                        <Select
                          label="Which plugin draws this"
                          value={slotChoices(stored())[point.id] ?? ''}
                          options={[
                            { value: '', label: `${pluginLabel(point.ownerId)}’s own` },
                            ...tied().map((entry) => ({ value: entry.pluginId, label: `${entry.label} (${entry.pluginId})` })),
                          ]}
                          onChange={(value) =>
                            // Point-wide, not per key: this screen lists points, and "who draws this
                            // slot" is the decision a person is here to make. A slot resolves the
                            // per-key answer first and falls back to this one.
                            void save.run(() => savePref(qc, PrefKeys.remoteSlots, withSlotChoice(stored(), point.id, value), { throwOnFailure: true }))}
                        />
                      </SettingRow>
                    </Show>
                  </li>
                )
              }}
            </For>
          </ul>
        </Show>
      </SettingsSection>

      <SettingsSection
        id="unmatched"
        label="Contributions that match nothing"
        help="When a plugin tries to add to a place that doesn't exist, it shows here and nowhere else."
      >
        <Show
          when={unmatched().length}
          fallback={<EmptyState align="start" size="sm">Everything contributed here has somewhere to go.</EmptyState>}
        >
          <ul class="plugin-point-list">
            <For each={unmatched()}>
              {(miss) => (
                <li class="plugin-point">
                  <span class="plugin-point-id">{miss.entry.pluginId} → {miss.entry.point}</span>
                  <Text emphasis="muted" wrap>
                    {sentence(miss.reason)}
                    <Show when={miss.suggestion}>{(suggestion) => ` Did you mean ${suggestion()}?`}</Show>
                  </Text>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </SettingsSection>
    </>
  )
}
