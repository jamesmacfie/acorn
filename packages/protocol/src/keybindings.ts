// The keyboard contract shared by the Node manifest parser, the shell dispatcher, and the
// sandboxed-frame SDK. Chords are persisted strings, so accepting a spelling that eventChord can
// never produce would create a setting that looks valid and can never fire.

export const CHORD_MODIFIERS = ['meta', 'ctrl', 'alt', 'shift'] as const
export type ChordModifier = (typeof CHORD_MODIFIERS)[number]

export type ParsedChord = { modifiers: ChordModifier[]; key: string }

const singleKey = (value: string): boolean =>
  value !== '+' && value.trim() === value && Array.from(value).length === 1

export function parseChord(value: string): ParsedChord | null {
  if (!value || value !== value.toLowerCase() || value.trim() !== value) return null
  const parts = value.split('+')
  const key = parts.pop()
  if (!key || (!singleKey(key) && key !== 'enter' && key !== 'escape')) return null
  if (parts.some((part) => !(CHORD_MODIFIERS as readonly string[]).includes(part))) return null
  if (new Set(parts).size !== parts.length) return null
  const ordered = CHORD_MODIFIERS.filter((modifier) => parts.includes(modifier))
  if (ordered.length !== parts.length || ordered.some((modifier, index) => modifier !== parts[index])) return null
  return { modifiers: ordered, key }
}

export const isNormalizedChord = (value: string): boolean => parseChord(value) !== null

// A plugin binding or claim must have a command modifier. Shift alone changes typed text and is not
// a safe application shortcut.
export const hasCommandModifier = (chord: string): boolean => {
  const parsed = parseChord(chord)
  return !!parsed?.modifiers.some((modifier) => modifier === 'meta' || modifier === 'ctrl' || modifier === 'alt')
}

export const isPluginShortcutChord = (chord: string): boolean =>
  isNormalizedChord(chord) && hasCommandModifier(chord)

// Clipboard, undo and select-all are implemented by the browser (on macOS, by the Edit menu's roles)
// against whatever is selected or focused. They carry a command modifier, so anything that cancels
// "modified chords" on principle cancels these too. That is why copying out of a sandboxed frame
// silently did nothing. Shift is ignored so redo (meta+shift+z) is covered with undo.
const EDITING_CHORD_KEYS = new Set(['a', 'c', 'v', 'x', 'z', 'y'])
export const isBrowserEditingChord = (chord: string): boolean => {
  const parsed = parseChord(chord)
  if (!parsed || !EDITING_CHORD_KEYS.has(parsed.key)) return false
  const modifiers = parsed.modifiers.filter((modifier) => modifier !== 'shift')
  return modifiers.length === 1 && (modifiers[0] === 'meta' || modifiers[0] === 'ctrl')
}

export const isReservedPluginKeyClaim = (chord: string): boolean =>
  chord === 'escape' || chord === 'meta+k' || chord === 'meta+,' || /^meta\+[1-9]$/.test(chord)

export const isPluginKeyClaim = (chord: string): boolean =>
  isPluginShortcutChord(chord) && !isReservedPluginKeyClaim(chord)

export const qualifiedPluginCommandId = (pluginId: string, commandId: string): string =>
  `plugin.${pluginId}.${commandId}`

export type KeyboardEventShape = {
  code: string
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const baseKey = (event: Pick<KeyboardEventShape, 'code' | 'key'>): string | null => {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  if (event.code === 'BracketLeft') return '['
  if (event.code === 'BracketRight') return ']'
  if (event.key === 'Enter') return 'enter'
  if (event.key === 'Escape') return 'escape'
  const key = event.key.toLowerCase()
  return Array.from(key).length === 1 && key !== '+' ? key : null
}

export function eventChord(event: KeyboardEventShape): string | null {
  const key = baseKey(event)
  if (!key) return null
  const parts: string[] = []
  if (event.metaKey) parts.push('meta')
  if (event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

// Structural rather than instanceof-based: this runs in the shell, a sandboxed frame, and Node
// tests. It intentionally recognizes the same EditContext surface Monaco uses as the old client-only
// predicate did.
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as {
    nodeName?: unknown
    tagName?: unknown
    isContentEditable?: unknown
    editContext?: unknown
  }
  const name = typeof element.nodeName === 'string'
    ? element.nodeName.toUpperCase()
    : typeof element.tagName === 'string'
      ? element.tagName.toUpperCase()
      : ''
  return name === 'INPUT'
    || name === 'TEXTAREA'
    || name === 'SELECT'
    || element.isContentEditable === true
    || element.editContext != null
}
