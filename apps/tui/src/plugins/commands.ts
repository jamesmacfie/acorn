import type { PluginInstallSource } from '@acorn/protocol/api.ts'
import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import { registerCommands, type CommandOutcome } from '@acorn/client-core/host/registries/commands'
import { installPluginOnDevice, readPluginHostState, removePluginFromDevice, setPluginDevGrant } from '@acorn/client-core/host/plugins'
import { devicePlugins } from '@acorn/client-core/host/plugins/distribution.ts'
import { reconcileDevicePluginChange } from '@acorn/client-core/host/plugins/reload.ts'
import { readDevicePrefs, removeDevicePluginPrefs, PrefKeys } from '@acorn/client-core/infra/persistence'
import { savePref } from '@acorn/client-core/features/settings/savePref.ts'
import { activeCacheId } from '@acorn/client-core/infra/node/activeNode.ts'
import { clientFor } from '@acorn/client-core/infra/node/fleet.ts'
import { CORE_EXCLUSIVE_SLOTS } from '@acorn/protocol/extensionPoints.ts'
import { CORE_SLOT_PROVIDER, exclusiveSlotChoices, withExclusiveSlotChoice } from '@acorn/client-core/host/registries/extensionPoints'
import { configPluginOffers } from '@acorn/client-core/infra/persistence/deviceConfigSync.ts'
import { describePluginSource } from '@acorn/protocol/plugin/source.ts'

const GROUP = 'core.device-plugins'
const status = (message: string): CommandOutcome => ({ effect: 'stay', status: message })

const parseNamed = (kind: 'github' | 'npm', text: string): PluginInstallSource => {
  const value = text.trim()
  const at = value.lastIndexOf('@')
  const name = at > 0 ? value.slice(0, at) : value
  const suffix = at > 0 ? value.slice(at + 1) : ''
  return kind === 'github'
    ? { github: name, ...(suffix ? { tag: suffix } : {}) }
    : { npm: name, ...(suffix ? { version: suffix } : {}) }
}

const available = (query: string, predicate: (id: string) => boolean = () => true): CommandSearchItem[] =>
  devicePlugins().filter((entry) => predicate(entry.row.name) && entry.row.name.toLowerCase().includes(query.trim().toLowerCase()))
    .map((entry) => ({ id: entry.row.name, title: entry.row.name, subtitle: `${entry.row.installed?.version ?? '?'} · ${entry.sourceLabel}` }))

const settle = async (): Promise<void> => reconcileDevicePluginChange()

/** Terminal installation and management through the shared command palette. No Node route is called. */
export function registerDevicePluginCommands() {
  return registerCommands([
    { id: GROUP, kind: 'group', title: 'Plugins on this device', category: 'action', scope: 'none', palette: true },
    ...(['github', 'npm', 'url'] as const).map((kind, order) => ({
      id: `${GROUP}.install.${kind}`, parentId: GROUP, kind: 'input' as const,
      title: `Install from ${kind === 'github' ? 'GitHub release' : kind === 'npm' ? 'npm package' : 'HTTPS URL'}`,
      category: 'action' as const, scope: 'none' as const, palette: true, order: 100 + order,
      placeholder: kind === 'github' ? 'owner/repo[@tag]' : kind === 'npm' ? 'package[@version]' : 'https://…/acorn-plugin.tgz',
      validate: (text: string) => text.trim() ? undefined : 'Enter a source.',
      submit: async (text: string) => {
        const source: PluginInstallSource = kind === 'url' ? { url: text.trim() } : parseNamed(kind, text)
        const result = await installPluginOnDevice(source)
        await settle()
        return status(`Installed ${result.pluginId}@${result.version}. Review its trust prompt.`)
      },
    })),
    {
      id: `${GROUP}.config`, parentId: GROUP, kind: 'search', title: 'Install a plugin requested by acorn.json',
      category: 'action', scope: 'none', palette: true, order: 150, minQueryLength: 0, debounceMs: 0,
      query: async (text: string) => configPluginOffers(new Set(devicePlugins().map((entry) => entry.row.name)))
        .filter((offer) => !('path' in offer.source) && offer.id.toLowerCase().includes(text.trim().toLowerCase()))
        .map((offer) => ({ id: offer.id, title: offer.id, subtitle: describePluginSource(offer.source) })),
      select: async (item: CommandSearchItem) => {
        const offer = configPluginOffers(new Set(devicePlugins().map((entry) => entry.row.name))).find((entry) => entry.id === item.id)
        if (!offer || 'path' in offer.source) throw new Error('That plugin request is no longer available.')
        const result = await installPluginOnDevice(offer.source, offer.id)
        await settle()
        return status(`Installed ${result.pluginId}@${result.version}. Review its trust prompt.`)
      },
    },
    {
      id: `${GROUP}.update`, parentId: GROUP, kind: 'search', title: 'Update a device plugin',
      category: 'action', scope: 'none', palette: true, order: 200, minQueryLength: 0, debounceMs: 0,
      query: async (text: string) => available(text, (id) => !!devicePlugins().find((entry) => entry.row.name === id)?.installSource),
      select: async (item: CommandSearchItem) => {
        const entry = devicePlugins().find((candidate) => candidate.row.name === item.id)
        if (!entry?.installSource) throw new Error('This plugin has no recorded source.')
        const result = await installPluginOnDevice(entry.installSource, entry.row.name)
        await settle()
        return status(`Updated ${result.pluginId}@${result.version}.`)
      },
    },
    {
      id: `${GROUP}.toggle`, parentId: GROUP, kind: 'search', title: 'Enable or disable a device plugin',
      category: 'action', scope: 'none', palette: true, order: 300, minQueryLength: 0, debounceMs: 0,
      query: async (text: string) => available(text),
      select: async (item: CommandSearchItem) => {
        const entry = devicePlugins().find((candidate) => candidate.row.name === item.id)
        if (!entry) throw new Error('That plugin is no longer installed.')
        let disabled: string[] = []
        try {
          const raw: unknown = JSON.parse(readDevicePrefs()[PrefKeys.devicePluginsDisabled] ?? '[]')
          if (Array.isArray(raw)) disabled = raw.filter((id): id is string => typeof id === 'string')
        } catch { /* An invalid old preference enables all plugins. */ }
        const next = entry.row.disabled ? disabled.filter((id) => id !== item.id) : [...new Set([...disabled, item.id])]
        await savePref(clientFor(activeCacheId()).client, PrefKeys.devicePluginsDisabled, JSON.stringify(next))
        await settle()
        return status(`${item.id} ${entry.row.disabled ? 'enabled' : 'disabled'}.`)
      },
    },
    {
      id: `${GROUP}.dev`, parentId: GROUP, kind: 'search', title: 'Toggle development trust',
      category: 'action', scope: 'none', palette: true, order: 400, minQueryLength: 0, debounceMs: 0,
      query: async (text: string) => available(text),
      select: async (item: CommandSearchItem) => {
        const state = await readPluginHostState()
        const granted = state.devGrants.some((grant) => grant.pluginId === item.id && grant.source?.kind === 'device')
        await setPluginDevGrant({ pluginId: item.id, nodeId: '', source: { kind: 'device' }, grant: !granted })
        await settle()
        return status(`${item.id} development trust ${granted ? 'ended' : 'enabled'}.`)
      },
    },
    {
      id: `${GROUP}.remove`, parentId: GROUP, kind: 'search', title: 'Remove a device plugin',
      category: 'action', scope: 'none', palette: true, order: 500, minQueryLength: 0, debounceMs: 0,
      query: async (text: string) => available(text),
      select: async (item: CommandSearchItem) => {
        await removePluginFromDevice(item.id)
        removeDevicePluginPrefs(item.id)
        const prefs = readDevicePrefs()
        const client = clientFor(activeCacheId()).client
        try {
          const disabled: unknown = JSON.parse(prefs[PrefKeys.devicePluginsDisabled] ?? '[]')
          if (Array.isArray(disabled)) await savePref(client, PrefKeys.devicePluginsDisabled, JSON.stringify(disabled.filter((id) => id !== item.id)))
        } catch { /* Invalid old preference has no membership to clear. */ }
        let slots = prefs[PrefKeys.exclusiveSlots]
        for (const slot of CORE_EXCLUSIVE_SLOTS) {
          if (exclusiveSlotChoices(slots)[slot] === item.id) slots = withExclusiveSlotChoice(slots, slot, CORE_SLOT_PROVIDER)
        }
        if (slots !== prefs[PrefKeys.exclusiveSlots] && slots !== undefined) await savePref(client, PrefKeys.exclusiveSlots, slots)
        await settle()
        return status(`Removed ${item.id}.`)
      },
    },
  ])
}
