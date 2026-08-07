import { PrefKeys } from './prefKeys'
import type { PersistedStateSlice, RestorePhase } from './persistedState'

const direct = (id: string, key: string, restore: RestorePhase = 'workspace', maxBytes = 8 * 1024): PersistedStateSlice<string> => ({
  id,
  key,
  scope: 'app',
  restore,
  version: 1,
  codec: {
    parse: (raw) => typeof raw === 'string' ? raw : '',
    serialize: (value) => value,
  },
  empty: () => '',
  unknownIds: 'retain-inert',
  maxBytes,
})

const jsonObject = (id: string, key: string, restore: RestorePhase = 'workspace', maxBytes = 32 * 1024): PersistedStateSlice<Record<string, unknown>> => ({
  id,
  key,
  scope: 'app',
  restore,
  version: 1,
  codec: {
    parse: (raw) => {
      try {
        const value = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
      } catch {
        return {}
      }
    },
    serialize: (value) => value,
  },
  empty: () => ({}),
  unknownIds: 'retain-inert',
  maxBytes,
})

// These preferences are read reactively from the query cache and written through savePref. They
// still declare durability, phase, codec and bounds, but need no separate in-memory binding.
export const directPreferenceSlices: readonly PersistedStateSlice<unknown>[] = [
  direct('core.theme-follow-system', PrefKeys.themeFollowSystem),
  direct('core.theme', PrefKeys.theme),
  direct('core.theme-light', PrefKeys.themeLight),
  direct('core.theme-dark', PrefKeys.themeDark),
  direct('core.style', PrefKeys.style),
  jsonObject('core.keybindings', PrefKeys.keybindings),
  jsonObject('core.pane-shortcuts-legacy', PrefKeys.paneShortcuts),
  direct('github.diff-view', PrefKeys.diffView, 'view'),
  jsonObject('core.rail-order', PrefKeys.railOrder, 'view'),
  direct('terminal.rail-default', PrefKeys.terminalRailDefault),
  direct('terminal.height', PrefKeys.terminalHeight, 'panes'),
  direct('terminal.font-size', PrefKeys.terminalFontSize, 'panes'),
  direct('core.startup-context-injection', PrefKeys.startupContextInjection),
  direct('core.onboarded', PrefKeys.onboarded),
  // A JSON array, so `direct` (a bare string) rather than `jsonObject` (a record) — the value is read
  // and written by nodeSecurity's warning gate, which parses it itself. 4 KiB is a few hundred nodeIds,
  // which is several orders of magnitude more fleet than exists.
  direct('core.disk-warning-acked', PrefKeys.diskWarningAcked, 'workspace', 4 * 1024),
  jsonObject('agent-tools.permissions', PrefKeys.agentToolPermissions),
] as readonly PersistedStateSlice<unknown>[]
