import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { intentKeys, BARE_KEYS } from '@acorn/client-core/kit/keys/keymap.ts'
import { createParser, ESC_TIMEOUT_MS } from './parser'
import { openTerminal } from './terminal'
import type { InputEvent, KeyEvent } from './events'

// The input parser, on its own. No OpenTUI anywhere in this file, so it runs on the Node the repo
// pins with no FFI and no flag, and every case is a byte sequence in and an event out.
//
// The load-bearing case is the last one. Everything else here is a sequence somebody could have
// mistyped; `no key is respelled` reads the app's own binding tables and insists that every key they
// name is a key this parser produces under that exact name. A parser that spells Page Down `pgdn` is
// not a bug you find by reading, it is a binding that silently never fires
// (./names.ts, docs/tui.md § Keys and focus).

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

/** Push bytes and collect what came out. The timeout is run at the end of every case: a completed
 *  sequence has left the machine in ground where it does nothing, and a lone ESC is only the Escape
 *  key once the wait is over. */
function read(...chunks: string[]): InputEvent[] {
  const events: InputEvent[] = []
  const parser = createParser((event) => events.push(event))
  for (const chunk of chunks) parser.push(bytes(chunk))
  parser.flushTimeout()
  parser.close()
  return events
}

const keys = (...chunks: string[]): KeyEvent[] =>
  read(...chunks).filter((event): event is KeyEvent => event.type === 'key')

/** A press with no modifiers, which is most of what this file expects. */
const press = (name: string, text = ''): InputEvent => (
  { type: 'key', name, text, action: 'press', ctrl: false, shift: false, alt: false, super: false }
)

const one = (...chunks: string[]): InputEvent => {
  const events = read(...chunks)
  expect(events).toHaveLength(1)
  return events[0]!
}

/** A key event as the four things a binding is matched on, which is what the keymap engine reads off
 *  it (`@opentui/keymap` § defaultEventMatchResolver). */
const chord = (event: KeyEvent): string => [
  event.ctrl ? 'ctrl' : '',
  event.alt ? 'meta' : '',
  event.super ? 'super' : '',
  event.shift ? 'shift' : '',
  event.name,
].filter(Boolean).join('+')

describe('the legacy forms', () => {
  it('reads the cursor and editing keys', () => {
    expect(keys('\x1b[A').map((key) => key.name)).toEqual(['up'])
    expect(keys('\x1b[B').map((key) => key.name)).toEqual(['down'])
    expect(keys('\x1b[C').map((key) => key.name)).toEqual(['right'])
    expect(keys('\x1b[D').map((key) => key.name)).toEqual(['left'])
    expect(keys('\x1b[H').map((key) => key.name)).toEqual(['home'])
    expect(keys('\x1b[F').map((key) => key.name)).toEqual(['end'])
    expect(keys('\x1b[5~').map((key) => key.name)).toEqual(['pageup'])
    expect(keys('\x1b[6~').map((key) => key.name)).toEqual(['pagedown'])
  })

  it('reads a modifier out of a parameter', () => {
    expect(chord(keys('\x1b[1;2A')[0]!)).toBe('shift+up')
    expect(chord(keys('\x1b[1;5A')[0]!)).toBe('ctrl+up')
    // `ctrl+meta+right`, which is `nextPane`. `meta` is the keymap's spelling for Option and Alt,
    // and it is the one word the two vocabularies disagree about
    // (packages/client-core/src/kit/keys/keymap.ts § MODIFIER_SPELLING).
    expect(chord(keys('\x1b[1;7C')[0]!)).toBe('ctrl+meta+right')
    expect(chord(keys('\x1b[6;5~')[0]!)).toBe('ctrl+pagedown')
  })

  it('reads SS3, which is the same keys in application mode', () => {
    expect(keys('\x1bOA').map((key) => key.name)).toEqual(['up'])
    expect(keys('\x1bOH').map((key) => key.name)).toEqual(['home'])
    expect(keys('\x1bOP').map((key) => key.name)).toEqual(['f1'])
    // The keypad's Enter is Return, and its digits are digits, so a reader on a numeric keypad
    // presses the same bindings as a reader on the top row.
    expect(keys('\x1bOM').map((key) => key.name)).toEqual(['return'])
    expect(keys('\x1bOq')[0]).toMatchObject({ name: '1', text: '1' })
  })

  it('names the four control characters that are keys, not the letters they share a byte with', () => {
    // Ctrl+H, Ctrl+I and Ctrl+M are Backspace, Tab and Return on the wire, and every reader presses
    // those three keys while nothing in the app binds those three chords (./names.ts § CONTROL_KEYS).
    expect(chord(keys('\x08')[0]!)).toBe('backspace')
    expect(chord(keys('\x7f')[0]!)).toBe('backspace')
    expect(chord(keys('\t')[0]!)).toBe('tab')
    expect(chord(keys('\r')[0]!)).toBe('return')
  })

  it('reads Ctrl and a letter, and gives it no text', () => {
    expect(chord(keys('\x03')[0]!)).toBe('ctrl+c')
    expect(chord(keys('\x0b')[0]!)).toBe('ctrl+k')
    expect(chord(keys('\x02')[0]!)).toBe('ctrl+b')
    expect(chord(keys('\x06')[0]!)).toBe('ctrl+f')
    expect(keys('\x06')[0]!.text).toBe('')
  })

  it('cannot tell Ctrl+Return from Return, which is why the app asks for the kitty protocol', () => {
    // Not a shortcoming of this parser: a legacy terminal sends the one byte for both, so `commit`
    // does not exist to be bound (docs/tui.md § The adapter). The kitty case below is the same key.
    expect(chord(keys('\r')[0]!)).toBe('return')
  })

  it('reads a letter as its lower case with the case in the shift flag', () => {
    expect(keys('j')[0]).toMatchObject({ name: 'j', text: 'j', shift: false })
    // `shift+g` is `last`, and a name of `G` would be a binding nothing matches.
    expect(keys('G')[0]).toMatchObject({ name: 'g', text: 'G', shift: true })
    expect(keys('/')[0]).toMatchObject({ name: '/', text: '/' })
    expect(keys(' ')[0]).toMatchObject({ name: 'space', text: ' ' })
    expect(keys('?')[0]).toMatchObject({ name: '?', text: '?' })
  })

  it('reads backtab as Tab with Shift', () => {
    expect(chord(keys('\x1b[Z')[0]!)).toBe('shift+tab')
  })

  it('reads an ESC prefix as Alt', () => {
    expect(chord(keys('\x1bj')[0]!)).toBe('meta+j')
    // And a chord types nothing, whatever the key would have typed on its own.
    expect(keys('\x1bj')[0]!.text).toBe('')
  })

  it('reads a character that takes more than one byte, across a chunk boundary', () => {
    const encoded = bytes('é')
    expect(encoded).toHaveLength(2)
    const seen: InputEvent[] = []
    const parser = createParser((event) => seen.push(event))
    // Half a character is not a key yet, so the first push says nothing at all.
    parser.push(new Uint8Array([encoded[0]!]))
    expect(seen).toEqual([])
    parser.push(new Uint8Array([encoded[1]!]))
    expect(seen).toEqual([press('é', 'é')])
    parser.close()
  })
})

describe('the kitty forms', () => {
  it('reads a functional key by its own code point', () => {
    expect(keys('\x1b[57352u').map((key) => key.name)).toEqual(['up'])
    expect(keys('\x1b[57355u').map((key) => key.name)).toEqual(['pagedown'])
    expect(keys('\x1b[57369u').map((key) => key.name)).toEqual(['f6'])
    expect(keys('\x1b[57363u').map((key) => key.name)).toEqual(['menu'])
  })

  it('tells Ctrl+Return from Return, and Escape from the start of a sequence', () => {
    expect(chord(keys('\x1b[13;5u')[0]!)).toBe('ctrl+return')
    expect(chord(keys('\x1b[13u')[0]!)).toBe('return')
    expect(chord(keys('\x1b[27u')[0]!)).toBe('escape')
  })

  it('reads the shifted code point as the text and the unshifted one as the name', () => {
    // Kitty reports `g` and `G` as one key and a modifier, which is exactly how the binding table
    // spells it.
    expect(keys('\x1b[103:71;2u')[0]).toMatchObject({ name: 'g', text: 'G', shift: true })
  })

  it('reads the text the terminal reports, when it reports any', () => {
    expect(keys('\x1b[97;1;97u')[0]).toMatchObject({ name: 'a', text: 'a' })
  })

  it('reads press, release and repeat', () => {
    expect(keys('\x1b[57352u')[0]!.action).toBe('press')
    expect(keys('\x1b[57352;1:2u')[0]!.action).toBe('repeat')
    expect(keys('\x1b[57352;1:3u')[0]!.action).toBe('release')
    // The event type also rides on the legacy functional forms, which is what a kitty terminal
    // sends for a cursor key once event reporting is on.
    expect(keys('\x1b[1;1:3A')[0]).toMatchObject({ name: 'up', action: 'release' })
  })

  it('answers the question of whether the terminal answered', () => {
    const events: InputEvent[] = []
    const parser = createParser((event) => events.push(event))
    expect(parser.kittyAnswered()).toBe(false)
    // The reply to `CSI ? u`, which is the one capability question this client asks. It is not a key.
    parser.push(bytes('\x1b[?7u'))
    expect(events).toEqual([])
    expect(parser.kittyAnswered()).toBe(true)
    parser.close()
  })

  it('reads a key in the CSI u form even from a terminal that never replied', () => {
    // Deliberate, and a departure from the phase design: a gate here cannot fail safe. A terminal
    // that speaks the protocol and leaves the query unanswered would have every key it sends this
    // way dropped, and those keys include Escape. Nothing else ends a CSI sequence with `u`.
    const events: InputEvent[] = []
    const parser = createParser((event) => events.push(event))
    parser.push(bytes('\x1b[27u'))
    expect(events).toEqual([press('escape')])
    expect(parser.kittyAnswered()).toBe(true)
    parser.close()
  })
})

describe('the mouse', () => {
  it('reads an SGR press and release, zero based', () => {
    expect(one('\x1b[<0;10;5M')).toEqual({
      type: 'mouse', x: 9, y: 4, button: 'left', action: 'press', ctrl: false, shift: false, alt: false, super: false,
    })
    expect(one('\x1b[<0;10;5m')).toMatchObject({ button: 'left', action: 'release' })
    expect(one('\x1b[<2;1;1M')).toMatchObject({ button: 'right', action: 'press', x: 0, y: 0 })
  })

  it('reads a wheel step, which carries no button', () => {
    expect(one('\x1b[<64;10;5M')).toMatchObject({ action: 'wheel', wheel: 'up', button: 'none' })
    expect(one('\x1b[<65;10;5M')).toMatchObject({ action: 'wheel', wheel: 'down' })
    // A trackpad's sideways swipe, and a modifier held over the wheel.
    expect(one('\x1b[<66;10;5M')).toMatchObject({ action: 'wheel', wheel: 'left' })
    expect(one('\x1b[<80;10;5M')).toMatchObject({ action: 'wheel', wheel: 'up', ctrl: true })
  })

  it('reads a drag as motion with the button that is down', () => {
    expect(one('\x1b[<32;10;5M')).toMatchObject({ action: 'move', button: 'left' })
    expect(one('\x1b[<35;10;5M')).toMatchObject({ action: 'move', button: 'none' })
  })

  it('reads the three modifiers SGR carries', () => {
    expect(one('\x1b[<4;1;1M')).toMatchObject({ shift: true })
    expect(one('\x1b[<8;1;1M')).toMatchObject({ alt: true })
    expect(one('\x1b[<16;1;1M')).toMatchObject({ ctrl: true })
  })
})

describe('focus', () => {
  it('reads DEC 1004 in and out', () => {
    expect(one('\x1b[I')).toEqual({ type: 'focus', state: 'in' })
    expect(one('\x1b[O')).toEqual({ type: 'focus', state: 'out' })
  })
})

describe('a paste', () => {
  it('arrives whole, as one event', () => {
    expect(one('\x1b[200~hello\x1b[201~')).toEqual({ type: 'paste', text: 'hello' })
  })

  it('survives arriving in pieces', () => {
    expect(read('\x1b[200~one', ' two', ' three\x1b[201~')).toEqual([
      { type: 'paste', text: 'one two three' },
    ])
  })

  it('is content and not keys, whatever is in it', () => {
    // The whole point of the bracket. A pasted newline is not Return pressed, and a pasted escape
    // sequence is not a key: paste it into a composer and it is text, which is why this state reads
    // raw bytes rather than running the machine over them.
    expect(read('\x1b[200~a\rb\x1b[Ac\x1b[201~')).toEqual([
      { type: 'paste', text: 'a\rb\x1b[Ac' },
    ])
  })

  it('leaves the keys after it as keys', () => {
    expect(read('\x1b[200~hi\x1b[201~j')).toEqual([
      { type: 'paste', text: 'hi' },
      press('j', 'j'),
    ])
  })

  it('reads an empty paste as an empty paste', () => {
    expect(one('\x1b[200~\x1b[201~')).toEqual({ type: 'paste', text: '' })
  })
})

describe('a lone Escape', () => {
  afterEach(() => { vi.useRealTimers() })

  it('is the key once the wait is over, and nothing before it', () => {
    vi.useFakeTimers()
    const events: InputEvent[] = []
    const parser = createParser((event) => events.push(event))
    parser.push(bytes('\x1b'))
    // Nothing yet: this is the first byte of every escape sequence there is.
    expect(events).toEqual([])
    vi.advanceTimersByTime(ESC_TIMEOUT_MS - 1)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toEqual([press('escape')])
    parser.close()
  })

  it('waits 20 ms, which is what OpenTUI waits', () => {
    // Its `DEFAULT_TIMEOUT_MS`, and the number its renderer passes explicitly at 0.5.9. Written down
    // here because a shorter wait turns a slow Down arrow into an Escape and a longer one makes
    // leaving a modal feel stuck.
    expect(ESC_TIMEOUT_MS).toBe(20)
  })

  it('is not the key when the rest of the sequence arrives in time', () => {
    vi.useFakeTimers()
    const events: InputEvent[] = []
    const parser = createParser((event) => events.push(event))
    parser.push(bytes('\x1b'))
    vi.advanceTimersByTime(ESC_TIMEOUT_MS - 5)
    parser.push(bytes('[A'))
    vi.advanceTimersByTime(100)
    expect(events).toEqual([press('up')])
    parser.close()
  })

  it('reads two in a row as two Escapes', () => {
    // A reader leaving a modal and then a panel presses it twice, and the second is often inside the
    // wait for the first.
    expect(keys('\x1b\x1b').map((key) => key.name)).toEqual(['escape', 'escape'])
  })
})

describe('what we asked for and do not act on', () => {
  it('drops a reply rather than reading it as keys', () => {
    // Each of these is an answer to a question either we or a library asked once at boot, and each
    // ends in a byte that is a key's final byte somewhere else. A parser that reads them as keys
    // types garbage into whatever has the keys at boot.
    expect(read('\x1b]11;rgb:1c/1c/1c\x07')).toEqual([])
    expect(read('\x1b]10;rgb:ff/ff/ff\x1b\\')).toEqual([])
    expect(read('\x1b[?62;1;2;6;9c')).toEqual([])
    expect(read('\x1b[24;80R')).toEqual([])
    expect(read('\x1bP>|kitty(0.42.0)\x1b\\')).toEqual([])
  })

  it('reads the keys either side of one', () => {
    expect(keys('j\x1b[?62;1c\x1b[A').map((key) => key.name)).toEqual(['j', 'up'])
  })
})

describe('the terminal', () => {
  /** A stdin and a stdout of our own, which is all this module wants of the real ones. */
  function fake(size: { columns: number; rows: number } = { columns: 100, rows: 30 }) {
    const stdin = new EventEmitter() as EventEmitter & { setRawMode?: (mode: boolean) => void }
    const raw: boolean[] = []
    stdin.setRawMode = (mode: boolean) => { raw.push(mode) }
    const written: string[] = []
    const stdout = { write: (text: string) => written.push(text), ...size }
    return { stdin, stdout, written, raw }
  }

  it('asks for every mode on the way in and pops each one on the way out', () => {
    const { stdin, stdout, written, raw } = fake()
    const terminal = openTerminal({ stdin: stdin as never, stdout })
    const enter = written.join('')
    // The alternate screen, the cursor, bracketed paste, SGR mouse, focus reporting, the kitty push
    // and the kitty query. Losing any one of these loses a capability the app has today.
    for (const asked of ['?1049h', '?25l', '?2004h', '?1000h', '?1002h', '?1006h', '?1004h', '>7u', '?u']) {
      expect(enter).toContain(asked)
    }
    expect(raw).toEqual([true])

    written.length = 0
    terminal.close()
    const leave = written.join('')
    for (const popped of ['<u', '?1004l', '?1006l', '?1002l', '?1000l', '?2004l', '?25h', '?1049l']) {
      expect(leave).toContain(popped)
    }
    // Reversed, so the alternate screen is the last thing given back and the reader's scrollback is
    // never drawn over by a mode still turning off.
    expect(leave.indexOf('<u')).toBeLessThan(leave.indexOf('?1049l'))
    expect(raw).toEqual([true, false])
  })

  it('asks for event reporting, which is what makes a release possible', () => {
    // `../main.tsx` asks OpenTUI for `{ disambiguate: true }` and gets flags 1 and 4: its
    // `buildKittyKeyboardFlags` sets 2 only for `events: true`, which nothing passes. So no terminal
    // has ever sent this app a key release. 7 is 1, 2 and 4 (./terminal.ts § KITTY_FLAGS).
    const { stdin, stdout, written } = fake()
    const terminal = openTerminal({ stdin: stdin as never, stdout })
    expect(written.join('')).toContain('\x1b[>7u')
    terminal.close()
  })

  it('turns the bytes it reads into events', () => {
    const { stdin, stdout } = fake()
    const terminal = openTerminal({ stdin: stdin as never, stdout })
    const events: InputEvent[] = []
    terminal.on((event) => events.push(event))
    stdin.emit('data', bytes('\x1b[B'))
    expect(events).toEqual([press('down')])
    terminal.close()
    // And stops when the terminal is given back, because the bytes after that are the shell's.
    stdin.emit('data', bytes('j'))
    expect(events).toHaveLength(1)
  })

  it('reports the size, and a new one on SIGWINCH', () => {
    const { stdin, stdout } = fake({ columns: 120, rows: 40 })
    const terminal = openTerminal({ stdin: stdin as never, stdout })
    expect(terminal.size()).toEqual({ cols: 120, rows: 40 })
    const events: InputEvent[] = []
    terminal.on((event) => events.push(event))
    stdout.columns = 90
    stdout.rows = 20
    process.emit('SIGWINCH')
    expect(events).toEqual([{ type: 'resize', cols: 90, rows: 20 }])
    terminal.close()
    process.emit('SIGWINCH')
    expect(events).toHaveLength(1)
  })

  it('falls back to 80 by 24 for a stdout that will not say', () => {
    const stdin = new EventEmitter()
    const terminal = openTerminal({ stdin: stdin as never, stdout: { write: () => {} } })
    expect(terminal.size()).toEqual({ cols: 80, rows: 24 })
    terminal.close()
  })
})

// Every binding in the app that names a key, in both forms, recorded rather than derived.
//
// Keyed by the binding string exactly as the tables spell it, because that is the thing that has to
// keep working. A key here with the wrong name in `./names.ts` fails; a key the tables gain with no
// recording here fails too, which is the prompt to record one.
const RECORDED: Record<string, { legacy?: string; kitty: string }> = {
  up: { legacy: '\x1b[A', kitty: '\x1b[57352u' },
  down: { legacy: '\x1b[B', kitty: '\x1b[57353u' },
  left: { legacy: '\x1b[D', kitty: '\x1b[57350u' },
  right: { legacy: '\x1b[C', kitty: '\x1b[57351u' },
  home: { legacy: '\x1b[H', kitty: '\x1b[57356u' },
  end: { legacy: '\x1b[F', kitty: '\x1b[57357u' },
  pageup: { legacy: '\x1b[5~', kitty: '\x1b[57354u' },
  pagedown: { legacy: '\x1b[6~', kitty: '\x1b[57355u' },
  delete: { legacy: '\x1b[3~', kitty: '\x1b[57349u' },
  backspace: { legacy: '\x7f', kitty: '\x1b[127u' },
  menu: { legacy: '\x1b[29~', kitty: '\x1b[57363u' },
  return: { legacy: '\r', kitty: '\x1b[13u' },
  space: { legacy: ' ', kitty: '\x1b[32u' },
  // Legacy Escape is one byte and the wait; `read` runs the wait at the end of every case.
  escape: { legacy: '\x1b', kitty: '\x1b[27u' },
  tab: { legacy: '\t', kitty: '\x1b[9u' },
  'shift+tab': { legacy: '\x1b[Z', kitty: '\x1b[9;2u' },
  f6: { legacy: '\x1b[17~', kitty: '\x1b[57369u' },
  'shift+f6': { legacy: '\x1b[17;2~', kitty: '\x1b[57369;2u' },
  'shift+f10': { legacy: '\x1b[21;2~', kitty: '\x1b[57373;2u' },
  // No legacy column, and that absence is the reason the app asks for the kitty protocol at all: a
  // legacy terminal sends `\r` for this and for Return, so there is nothing to record.
  'ctrl+return': { kitty: '\x1b[13;5u' },
  'ctrl+f': { legacy: '\x06', kitty: '\x1b[102;5u' },
  'ctrl+meta+right': { legacy: '\x1b[1;7C', kitty: '\x1b[57351;7u' },
  'ctrl+meta+left': { legacy: '\x1b[1;7D', kitty: '\x1b[57350;7u' },
  j: { legacy: 'j', kitty: '\x1b[106u' },
  k: { legacy: 'k', kitty: '\x1b[107u' },
  h: { legacy: 'h', kitty: '\x1b[104u' },
  l: { legacy: 'l', kitty: '\x1b[108u' },
  g: { legacy: 'g', kitty: '\x1b[103u' },
  'shift+g': { legacy: 'G', kitty: '\x1b[103:71;2u' },
  '/': { legacy: '/', kitty: '\x1b[47u' },
}

/** The keys this host adds to the shared table, read out of the file that adds them rather than
 *  copied, for the same reason as everything else here. */
function hostKeys(): string[] {
  const source = readFileSync(fileURLToPath(new URL('../keys/install.ts', import.meta.url)), 'utf8')
  const block = /const HOST_KEYS[^=]*=\s*\{([^}]*)\}/.exec(source)
  // A rename of that constant must fail rather than quietly test two fewer keys.
  expect(block).not.toBeNull()
  return [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]!)
}

describe('no key is respelled', () => {
  // `intentKeys` is the table both hosts read, so a spelling here is a spelling the desktop shares;
  // `BARE_KEYS` is the set the typing shadow goes quiet for. Read, not copied: a test with its own
  // copy of the table is a test that passes while the app is broken.
  const bound = [...new Set([
    ...Object.values(intentKeys('ctrl')).flat(),
    ...BARE_KEYS,
    ...hostKeys(),
  ])].sort()

  it('has a recorded sequence for every key the app binds', () => {
    expect(bound.filter((key) => RECORDED[key] === undefined)).toEqual([])
    // Anti-vacuity: the tables are real and they are not empty.
    expect(bound.length).toBeGreaterThan(20)
    expect(bound).toContain('pagedown')
    expect(bound).toContain('tab')
    expect(bound).toContain('ctrl+return')
  })

  it.each(Object.keys(RECORDED))('produces %s from both forms', (binding) => {
    const recorded = RECORDED[binding]!
    const forms = [recorded.legacy, recorded.kitty].filter((form) => form !== undefined)
    for (const form of forms) {
      const pressed = keys(form)
      expect(pressed).toHaveLength(1)
      expect(chord(pressed[0]!)).toBe(binding)
    }
  })
})
