// Kept as the client import seam while the implementation lives in protocol so the Node manifest
// parser and sandboxed-frame SDK normalize exactly the same strings.
export { eventChord } from '@acorn/protocol/keybindings.ts'

const symbols: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
const displayOrder = ['ctrl', 'alt', 'shift', 'meta']

export function formatChord(chord: string): string {
  const parts = chord.split('+')
  const key = parts.pop() ?? ''
  const modifiers = displayOrder.filter((modifier) => parts.includes(modifier)).map((modifier) => symbols[modifier]).join('')
  return modifiers + (key === 'enter' ? '↩' : key === 'escape' ? 'Esc' : key.toUpperCase())
}
