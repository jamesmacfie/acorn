import { createMemo, onCleanup, onMount } from 'solid-js'
import { isTerminalTarget, isTypingTarget } from '../lib/isTypingTarget'
import { eventChord } from '../tasks/paneShortcuts'
import { executeCommand } from './commands'
import { Registry, type Disposable } from './registry'

export type KeybindingScope = 'global' | 'task' | 'pane' | 'typing-exempt'

export type KeybindingContribution = {
  id: string
  command: string
  description: string
  category: string
  defaultChord: string
  when?: KeybindingScope
  pane?: string
  legacyPaneAction?: string
  active?: () => boolean
}

export type KeybindingPrefs = { keybindings?: string; pane_shortcuts?: string }
export type ResolvedKeybinding = KeybindingContribution & { chord: string | null; conflict?: string }

export const keybindingRegistry = new Registry<KeybindingContribution>('keybinding')

const parseObject = (json: string | undefined): Record<string, unknown> => {
  if (!json) return {}
  try {
    const value = JSON.parse(json) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export const readKeybindingOverrides = (json: string | undefined): Record<string, string | null> => {
  const raw = parseObject(json)
  const result: Record<string, string | null> = {}
  for (const [id, chord] of Object.entries(raw)) {
    if (typeof chord === 'string') result[id] = chord.trim() || null
    else if (chord === null) result[id] = null
  }
  return result
}

const scopesConflict = (a: KeybindingContribution, b: KeybindingContribution): boolean => {
  const aScope = a.when ?? 'global'
  const bScope = b.when ?? 'global'
  if (aScope === 'pane' && bScope === 'pane') return a.pane === b.pane
  return true
}

export function resolveKeybindings(
  bindings: readonly KeybindingContribution[],
  prefs: KeybindingPrefs = {},
): ResolvedKeybinding[] {
  const overrides = readKeybindingOverrides(prefs.keybindings)
  const legacy = parseObject(prefs.pane_shortcuts)
  const resolved: ResolvedKeybinding[] = []
  for (const binding of bindings) {
    const overridden = Object.prototype.hasOwnProperty.call(overrides, binding.id)
    const rawLegacyChord = binding.legacyPaneAction ? legacy[binding.legacyPaneAction] : undefined
    const legacyChord = typeof rawLegacyChord === 'string' && rawLegacyChord.length === 1 ? `meta+${rawLegacyChord.toLowerCase()}` : rawLegacyChord
    const chord = overridden
      ? overrides[binding.id]
      : typeof legacyChord === 'string' && legacyChord.trim()
        ? legacyChord
        : binding.defaultChord
    if (!chord) {
      resolved.push({ ...binding, chord: null })
      continue
    }
    const conflict = resolved.find((candidate) => candidate.chord === chord && scopesConflict(binding, candidate))
    resolved.push({
      ...binding,
      chord: conflict ? null : chord,
      ...(conflict ? { conflict: conflict.description } : {}),
    })
  }
  return resolved
}

export const keybindingConflict = (
  id: string,
  chord: string,
  bindings: readonly KeybindingContribution[],
  prefs: KeybindingPrefs,
): ResolvedKeybinding | undefined => {
  const current = bindings.find((binding) => binding.id === id)
  if (!current) return undefined
  const others = resolveKeybindings(bindings.filter((binding) => binding.id !== id), prefs)
  const conflict = others.find((binding) => binding.chord === chord && scopesConflict(current, binding))
  return conflict ? { ...current, chord: null, conflict: conflict.description } : undefined
}

export function registerKeybindings(bindings: readonly KeybindingContribution[]): Disposable {
  const disposables = bindings.map((binding) => keybindingRegistry.register(binding))
  return { dispose: () => [...disposables].reverse().forEach((disposable) => disposable.dispose()) }
}

export function KeybindingDispatcher(props: {
  prefs: KeybindingPrefs
  taskActive: boolean
  focusedPane?: string
}) {
  const resolved = createMemo(() => resolveKeybindings(keybindingRegistry.entries(), props.prefs))

  const scopeActive = (binding: ResolvedKeybinding, event: KeyboardEvent): boolean => {
    if (binding.active && !binding.active()) return false
    const scope = binding.when ?? 'global'
    if (scope === 'task' && !props.taskActive) return false
    if (scope === 'pane' && (!props.taskActive || props.focusedPane !== binding.pane)) return false
    if (scope !== 'global' && isTypingTarget(event.target) && !(event.metaKey && isTerminalTarget(event.target))) return false
    if (scope === 'typing-exempt' && isTypingTarget(event.target)) return false
    return true
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"]')) return
      const chord = eventChord(event)
      if (!chord) return
      const binding = resolved().find((candidate) => candidate.chord === chord && scopeActive(candidate, event))
      if (!binding) return
      event.preventDefault()
      event.stopPropagation()
      void executeCommand(binding.command).catch((error) => console.error(`[command:${binding.command}]`, error))
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    onCleanup(() => window.removeEventListener('keydown', onKeyDown, { capture: true }))
  })
  return null
}
