import { For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { CORE_EXCLUSIVE_SLOTS } from '@acorn/protocol/extensionPoints.ts'
import { integrationsOptions, prefsOptions } from '../../../infra/queries'
import { PrefKeys } from '../../../infra/persistence/prefKeys'
import { pluginLabel } from '../../../host/plugins/pluginLabel'
import {
  CORE_SLOT_PROVIDER, exclusiveSlotChoices, exclusiveSlotFailed, exclusiveSlotOffers, withExclusiveSlotChoice, type CoreExclusiveSlot,
} from '../../../host/registries/extensionPoints/exclusiveSlots'
import { Checkbox, Select } from '../../../kit/components/primitives'
import { Text } from '../../../kit/components/content/Text'
import { SettingRow } from '../../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../../kit/components/layout/SettingsSection'
import { availableSources } from '../../tabs/railSources'
import { createRailVisibility, pluginSources } from '../../tabs/railVisibility'
import { createSettingSave, type SettingSave } from '../settingSave'
import { savePref } from '../savePref'
import './plugins.css'

// Settings > Plugins > Rail and surfaces: what plugins put in this device's chrome
// (docs/frontend.md § Rail source visibility). A switch for every plugin source's left-rail icon, so a
// source that starts hidden, or one whose plugin has no settings page, can always be found and shown.
// Then the core surfaces a plugin has offered to draw instead of acorn.
//
// Both are this device's. The same plugin on every node this device pairs with shows or hides together.

export default function RailSurfacesSettings() {
  return (
    <>
      <RailSources />
      <ReplacedSurfaces />
    </>
  )
}

function RailSources() {
  const visibility = createRailVisibility()
  const integrations = createQuery(() => integrationsOptions(true))
  const sources = () => pluginSources().map(({ pluginId, source }) => ({ pluginId, ...source }))
  // Whether the source could open now. Its icon waits for that as well as for the switch, and the switch
  // keeps its value in the meantime.
  const available = () => new Set(availableSources(integrations.data?.integrations).map((source) => source.id))
  type PluginRailSource = ReturnType<typeof sources>[number]
  const saves = new Map<string, SettingSave>()
  const saveFor = (source: PluginRailSource) => {
    const key = `${source.pluginId}:${source.id}`
    let save = saves.get(key)
    if (!save) saves.set(key, save = createSettingSave())
    return save
  }
  const description = (source: PluginRailSource) => [
    `From the ${pluginLabel(source.pluginId)} plugin.`,
    source.showInRailByDefault === false ? 'Hidden until you show it.' : '',
    available().has(source.id)
      ? 'The command palette opens it either way.'
      : 'Its icon appears once the source is available, such as when its connection is signed in.',
  ].filter(Boolean).join(' ')

  return (
    <SettingsSection
      id="rail"
      label="Left rail"
      description="Which plugin sources have an icon in the left rail. A hidden source still works: its commands, panes and notifications stay, and the palette opens it."
    >
      <For each={sources()} fallback={<Text emphasis="muted">No plugin adds a source to the left rail.</Text>}>
        {(source) => (
          <SettingRow label={source.label} description={description(source)} error={saveFor(source).error()}>
            <Checkbox
              switch
              ariaLabel={`Show ${source.label} in left rail`}
              checked={visibility.shown(source.id)}
              onChange={(on) => saveFor(source).run(() => visibility.setShown(source.pluginId, source.id, on, { throwOnFailure: true }))}
            />
          </SettingRow>
        )}
      </For>
    </SettingsSection>
  )
}

// The exclusive-slot picker (registries/exclusiveSlots.ts, docs/plugins.md § Replacing a core
// surface). Hides when nobody has offered a replacement.
function ReplacedSurfaces() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const stored = () => prefs.data?.[PrefKeys.exclusiveSlots]
  const choice = (slot: CoreExclusiveSlot) => exclusiveSlotChoices(stored())[slot] ?? CORE_SLOT_PROVIDER
  const rows = () =>
    CORE_EXCLUSIVE_SLOTS.map((slot) => ({ slot, offers: exclusiveSlotOffers(slot) })).filter((row) => row.offers.length)
  // One save state per surface, so a failed write is said beside the picker that made it.
  const saves = Object.fromEntries(CORE_EXCLUSIVE_SLOTS.map((slot) => [slot, createSettingSave()])) as Record<CoreExclusiveSlot, SettingSave>
  const pick = (slot: CoreExclusiveSlot, value: string) =>
    saves[slot].run(() => savePref(qc, PrefKeys.exclusiveSlots, withExclusiveSlotChoice(stored(), slot, value), { throwOnFailure: true }))

  return (
    <SettingsSection
      id="surfaces"
      label="Replaced surfaces"
      description="Some plugins offer to draw one of acorn's own surfaces. Nothing is replaced until you pick it here, and acorn draws its own again if that plugin is turned off or its surface fails."
    >
      <Show when={rows().length} fallback={<Text emphasis="muted">No plugin offers to draw one of acorn's surfaces.</Text>}>
        <For each={rows()}>
          {(row) => (
            <SettingRow
              label={CORE_SLOT_LABEL[row.slot]}
              error={saves[row.slot].error()}
              onReset={choice(row.slot) === CORE_SLOT_PROVIDER ? undefined : () => void pick(row.slot, CORE_SLOT_PROVIDER)}
            >
              <Select
                label={CORE_SLOT_LABEL[row.slot]}
                value={choice(row.slot)}
                options={[
                  { value: CORE_SLOT_PROVIDER, label: "acorn's own" },
                  ...row.offers.map((offer) => ({
                    value: offer.pluginId,
                    label: `${offer.label} (${pluginLabel(offer.pluginId)})${!offer.placesNestedSlot && row.slot === 'rail' ? ' — hides the task list' : ''}${!offer.placesNestedSlot && row.slot === 'topbar' ? ' — hides plugin status items' : ''}`,
                  })),
                ]}
                onChange={(value) => void pick(row.slot, value)}
              />
              <For each={row.offers.filter((offer) => !offer.placesNestedSlot && (row.slot === 'rail' || row.slot === 'topbar'))}>
                {(offer) => <span class="muted" role="note">
                  {offer.label} {row.slot === 'rail' ? 'hides the task list' : 'hides plugin status items'}.
                </span>}
              </For>
              {/* A replacement that fell back is the one case where the setting and the screen
                  disagree, and the owner has no other way to find out why. */}
              <Show when={choice(row.slot) !== CORE_SLOT_PROVIDER && exclusiveSlotFailed(row.slot, choice(row.slot))}>
                <span class="plugin-failed" role="status">that surface failed — acorn's own is showing</span>
              </Show>
            </SettingRow>
          )}
        </For>
      </Show>
    </SettingsSection>
  )
}

// Core's own name for each designated surface, because the label says which of acorn's surfaces is
// being replaced. The plugin's own label is already the option text.
const CORE_SLOT_LABEL: Record<CoreExclusiveSlot, string> = {
  'rail.taskList': 'Task list in the rail',
  'pane.switcher': 'Pane switcher',
  rail: 'Left rail',
  topbar: 'Top bar',
}
