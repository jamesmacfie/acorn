import type { KeybindingContribution } from '../registries/keybindings'

export const visibleShortcutBindings = <T extends KeybindingContribution>(bindings: readonly T[]): T[] =>
  bindings.filter((binding) => binding.plugin?.state() !== 'absent')

export const orphanedPluginOverrideIds = (
  overrides: Readonly<Record<string, string | null>>,
  bindings: readonly KeybindingContribution[],
): string[] => {
  const known = new Set(bindings.map((binding) => binding.id))
  return Object.keys(overrides).filter((id) => id.startsWith('plugin.') && !known.has(id)).sort()
}

export const removeOverrideIds = <T>(overrides: Readonly<Record<string, T>>, ids: Iterable<string>): Record<string, T> => {
  const removed = new Set(ids)
  return Object.fromEntries(Object.entries(overrides).filter(([id]) => !removed.has(id)))
}
