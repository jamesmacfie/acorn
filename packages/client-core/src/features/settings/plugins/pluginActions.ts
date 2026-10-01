import type { QueryClient } from '@tanstack/solid-query'
import { prefsKey, type NodePluginRow, type NodePluginState } from '@acorn/protocol/api.ts'
import { CORE_EXCLUSIVE_SLOTS } from '@acorn/protocol/extensionPoints.ts'
import { saveDisabledNodePlugins } from '../../../infra/node/nodePlugins'
import { removePluginFromDevice } from '../../../host/plugins/host'
import { reconcileDevicePluginChange } from '../../../host/plugins/reload'
import { readDevicePrefs, removeDevicePluginPrefs } from '../../../infra/persistence/devicePrefs'
import { PrefKeys } from '../../../infra/persistence/prefKeys'
import { CORE_SLOT_PROVIDER, exclusiveSlotChoices, withExclusiveSlotChoice } from '../../../host/registries/extensionPoints/exclusiveSlots'
import { savePref } from '../savePref'
import { nextDisabledList } from './pluginToggle'

// The writes more than one place makes: the Installed list, a plugin's own page, and the plugin strip
// above that plugin's settings page all turn a plugin on and off, and the list and the page both remove a
// device plugin. Each writes where the plugin is kept today and nowhere else.

/** On or off at the node's next start. The route takes the whole disabled list, so it is recomputed from
 *  the rows the caller is looking at (./pluginToggle.ts). */
export const setNodePluginEnabled = (rows: readonly NodePluginRow[], id: string, enabled: boolean, nodeId?: string): Promise<NodePluginState> =>
  saveDisabledNodePlugins(nextDisabledList(rows, id, !enabled), nodeId)

const deviceDisabled = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(readDevicePrefs()[PrefKeys.devicePluginsDisabled] ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    // An unreadable old list means nothing is off.
    return []
  }
}

/** On or off on this device, at once: the device list is read on every reconcile. */
export async function setDevicePluginEnabled(qc: QueryClient, id: string, enabled: boolean): Promise<void> {
  const ids = deviceDisabled()
  const next = enabled ? ids.filter((candidate) => candidate !== id) : [...new Set([...ids, id])]
  await savePref(qc, PrefKeys.devicePluginsDisabled, JSON.stringify(next), { throwOnFailure: true })
  await reconcileDevicePluginChange()
}

/** Take a client-only plugin off this device, with every preference this device kept for it: its own
 *  `plugin:<id>:` keys, its place in the disabled list, and any core surface it was picked to draw. */
export async function removeDevicePlugin(qc: QueryClient, id: string): Promise<void> {
  await removePluginFromDevice(id)
  removeDevicePluginPrefs(id)
  if (readDevicePrefs()[PrefKeys.devicePluginsDisabled] !== undefined) {
    await savePref(qc, PrefKeys.devicePluginsDisabled, JSON.stringify(deviceDisabled().filter((candidate) => candidate !== id)))
  }
  qc.setQueryData<Record<string, string>>(prefsKey, (previous) => Object.fromEntries(
    Object.entries(previous ?? {}).filter(([key]) => !key.startsWith(`plugin:${id}:`)),
  ))
  const stored = readDevicePrefs()[PrefKeys.exclusiveSlots]
  let slots = stored
  for (const slot of CORE_EXCLUSIVE_SLOTS) {
    if (exclusiveSlotChoices(slots)[slot] === id) slots = withExclusiveSlotChoice(slots, slot, CORE_SLOT_PROVIDER)
  }
  if (slots !== stored && slots !== undefined) await savePref(qc, PrefKeys.exclusiveSlots, slots)
  await reconcileDevicePluginChange()
}
