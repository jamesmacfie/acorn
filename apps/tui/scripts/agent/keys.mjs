const special = {
  up: { code: 57352, legacy: '\x1b[A', final: 'A' },
  down: { code: 57353, legacy: '\x1b[B', final: 'B' },
  right: { code: 57351, legacy: '\x1b[C', final: 'C' },
  left: { code: 57350, legacy: '\x1b[D', final: 'D' },
  home: { code: 57356, legacy: '\x1b[H', final: 'H' },
  end: { code: 57357, legacy: '\x1b[F', final: 'F' },
  pageup: { code: 57354, legacy: '\x1b[5~', tilde: 5 },
  pagedown: { code: 57355, legacy: '\x1b[6~', tilde: 6 },
  insert: { code: 57348, legacy: '\x1b[2~', tilde: 2 },
  delete: { code: 57349, legacy: '\x1b[3~', tilde: 3 },
  tab: { code: 9, legacy: '\t' },
  return: { code: 13, legacy: '\r' },
  escape: { code: 27, legacy: '\x1b' },
  backspace: { code: 127, legacy: '\x7f' },
  space: { code: 32, legacy: ' ' },
  menu: { code: 57363, legacy: '\x1b[29~', tilde: 29 },
  f1: { code: 57364, legacy: '\x1bOP', final: 'P' },
  f2: { code: 57365, legacy: '\x1bOQ', final: 'Q' },
  f3: { code: 57366, legacy: '\x1bOR', final: 'R' },
  f4: { code: 57367, legacy: '\x1bOS', final: 'S' },
  f5: { code: 57368, legacy: '\x1b[15~', tilde: 15 },
  f6: { code: 57369, legacy: '\x1b[17~', tilde: 17 },
  f7: { code: 57370, legacy: '\x1b[18~', tilde: 18 },
  f8: { code: 57371, legacy: '\x1b[19~', tilde: 19 },
  f9: { code: 57372, legacy: '\x1b[20~', tilde: 20 },
  f10: { code: 57373, legacy: '\x1b[21~', tilde: 21 },
  f11: { code: 57374, legacy: '\x1b[23~', tilde: 23 },
  f12: { code: 57375, legacy: '\x1b[24~', tilde: 24 },
}

const aliases = { enter: 'return', esc: 'escape', pgup: 'pageup', pgdn: 'pagedown', alt: 'meta' }

export function keyBytes(chord, keyboard = 'kitty') {
  const parts = chord.toLowerCase().split('+').map((part) => aliases[part] ?? part)
  const key = parts.pop()
  if (!key || parts.some((part) => !['ctrl', 'shift', 'meta', 'super'].includes(part)) || new Set(parts).size !== parts.length) {
    throw new Error(`Invalid key chord: ${chord}`)
  }
  const entry = special[key]
  if (!entry && [...key].length !== 1) throw new Error(`Unknown key: ${key}`)
  const code = entry?.code ?? key.codePointAt(0)
  const shift = parts.includes('shift')
  const meta = parts.includes('meta')
  const ctrl = parts.includes('ctrl')
  const sup = parts.includes('super')
  const modifier = 1 + (shift ? 1 : 0) + (meta ? 2 : 0) + (ctrl ? 4 : 0) + (sup ? 8 : 0)

  if (keyboard === 'kitty') {
    if (modifier === 1 && entry) return `\x1b[${code}u`
    if (modifier === 1 && !entry) return key
    const shifted = !entry && shift && /[a-z]/.test(key) ? `:${key.toUpperCase().codePointAt(0)}` : ''
    return `\x1b[${code}${shifted};${modifier}u`
  }
  if (keyboard !== 'legacy') throw new Error(`Unknown keyboard mode: ${keyboard}`)
  if (sup) throw new Error(`The legacy terminal cannot send ${chord}.`)
  if (entry) {
    if (ctrl && (key === 'return' || key === 'tab' || key === 'escape' || key === 'backspace')) {
      throw new Error(`The legacy terminal cannot distinguish ${chord}. Use --keyboard kitty.`)
    }
    if (modifier === 1) return entry.legacy
    if (key === 'tab' && shift && !ctrl && !meta) return '\x1b[Z'
    if (entry.final) return `\x1b[1;${modifier}${entry.final}`
    if (entry.tilde) return `\x1b[${entry.tilde};${modifier}~`
    throw new Error(`The legacy terminal cannot send ${chord}.`)
  }
  if (ctrl && /^[a-z]$/.test(key)) return `${meta ? '\x1b' : ''}${String.fromCharCode(key.charCodeAt(0) - 96)}`
  if (ctrl) throw new Error(`The legacy terminal cannot send ${chord}.`)
  const character = shift ? key.toUpperCase() : key
  return `${meta ? '\x1b' : ''}${character}`
}
