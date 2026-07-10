// Canonical chord encoding shared by the keybinding dispatcher and remapping UI. Binding ownership,
// defaults, conflict detection, and legacy preference fallback live in registries/keybindings.tsx.
const baseKey = (event: KeyboardEvent): string | null => {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  if (event.code === 'BracketLeft') return '['
  if (event.code === 'BracketRight') return ']'
  if (event.key === 'Enter') return 'enter'
  if (event.key === 'Escape') return 'escape'
  const key = event.key.toLowerCase()
  return key.length === 1 ? key : null
}

export function eventChord(event: KeyboardEvent): string | null {
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

const symbols: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
const displayOrder = ['ctrl', 'alt', 'shift', 'meta']

export function formatChord(chord: string): string {
  const parts = chord.split('+')
  const key = parts.pop() ?? ''
  const modifiers = displayOrder.filter((modifier) => parts.includes(modifier)).map((modifier) => symbols[modifier]).join('')
  return modifiers + (key === 'enter' ? '↩' : key === 'escape' ? 'Esc' : key.toUpperCase())
}
