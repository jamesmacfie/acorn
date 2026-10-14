// The one way the app writes a shortcut: modifiers as Mac symbols in a fixed order (⌃⌥⇧⌘), then the
// key. It reads both spellings a chord arrives in: the keybinding registry's `meta+shift+n` and the
// keymap's `shift+super+n`. A space separates the steps of a sequence.
const MODIFIERS: Record<string, string> = {
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  meta: '⌘',
  super: '⌘',
  cmd: '⌘',
}
const ORDER = ['⌃', '⌥', '⇧', '⌘']
const KEYS: Record<string, string> = {
  enter: '↩',
  return: '↩',
  escape: 'Esc',
  esc: 'Esc',
  space: 'Space',
  tab: 'Tab',
  backspace: '⌫',
  delete: '⌦',
  arrowup: '↑',
  up: '↑',
  arrowdown: '↓',
  down: '↓',
  arrowleft: '←',
  left: '←',
  arrowright: '→',
  right: '→',
}

function formatStep(step: string): string {
  // A chord whose key is `+` ends in `++`; split would lose it.
  const plusKey = step.length > 1 && step.endsWith('++')
  const parts = (plusKey ? step.slice(0, -2) : step).split('+').filter(Boolean)
  const key = plusKey ? '+' : (parts.pop() ?? '')
  const symbols = new Set(parts.map((part) => MODIFIERS[part.toLowerCase()]).filter(Boolean))
  const lower = key.toLowerCase()
  return (
    ORDER.filter((symbol) => symbols.has(symbol)).join('') + (KEYS[lower] ?? key.charAt(0).toUpperCase() + key.slice(1))
  )
}

export function formatChord(chord: string): string {
  return chord.trim().split(/\s+/).map(formatStep).join(' ')
}

// A written chord as the caps that draw it: one list per step, one entry per key. Each leading
// modifier symbol is its own key and the rest of the step is one key, so `⇧⌘G` is three and `⌘Esc` two.
export function chordKeys(display: string): string[][] {
  return display
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((step) => {
      const keys: string[] = []
      let rest = step
      while (rest.length > 1 && ORDER.includes(rest.charAt(0))) {
        keys.push(rest.charAt(0))
        rest = rest.slice(1)
      }
      return rest ? [...keys, rest] : keys
    })
}
