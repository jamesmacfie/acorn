import type { DeviceConfig } from '@acorn/protocol/deviceConfig.ts'
import type { PluginInstallSource } from '@acorn/protocol/api.ts'
import { PrefKeys } from './prefKeys'

const scalarKeys = {
  theme: PrefKeys.theme,
  themeLight: PrefKeys.themeLight,
  themeDark: PrefKeys.themeDark,
  style: PrefKeys.style,
} as const
const jsonKeys = {
  keybindings: PrefKeys.keybindings,
  railOrder: PrefKeys.railOrder,
  railSourceVisibility: PrefKeys.railSourceVisibility,
  exclusiveSlots: PrefKeys.exclusiveSlots,
} as const

export const deviceConfigPrefs = (config: DeviceConfig): Record<string, string> => {
  const prefs: Record<string, string> = {}
  for (const [field, key] of Object.entries(scalarKeys)) {
    const value = config[field]
    if (typeof value === 'string') prefs[key] = value
  }
  for (const [field, key] of Object.entries(jsonKeys)) {
    const value = config[field]
    if (value !== undefined) prefs[key] = JSON.stringify(value)
  }
  if (typeof config.themeFollowSystem === 'boolean') prefs[PrefKeys.themeFollowSystem] = String(config.themeFollowSystem)
  if (typeof config.leftCollapsed === 'boolean') prefs[PrefKeys.leftCollapsed] = String(config.leftCollapsed)
  return prefs
}

export const configPatchForPref = (key: string, value: string): Partial<DeviceConfig> | null => {
  for (const [field, pref] of Object.entries(scalarKeys)) {
    if (pref === key) return { [field]: value }
  }
  for (const [field, pref] of Object.entries(jsonKeys)) {
    if (pref !== key) continue
    try { return { [field]: JSON.parse(value) as unknown } }
    catch { return null }
  }
  if (key === PrefKeys.themeFollowSystem) return { themeFollowSystem: value === 'true' }
  if (key === PrefKeys.leftCollapsed) return { leftCollapsed: value === 'true' }
  return null
}

/** A file entry asks for the normal install flow; it is never a trust decision. */
export const deviceConfigInstallOffers = (
  config: DeviceConfig,
  installed: ReadonlySet<string>,
): { id: string; source: PluginInstallSource }[] =>
  (config.plugins ?? []).filter((plugin) => !installed.has(plugin.id))
