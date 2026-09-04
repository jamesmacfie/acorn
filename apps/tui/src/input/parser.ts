import {
  NO_MODIFIERS,
  type InputEvent,
  type KeyAction,
  type Modifiers,
  type MouseAction,
  type MouseButton,
  type WheelDirection,
} from './events'
import {
  CONTROL_KEYS, KITTY_KEYS, KITTY_TEXT, LETTER_KEYS, SS3_ONLY, SS3_TEXT, TILDE_KEYS,
} from './names'

// Bytes from a terminal, as events.
//
// A state machine over five states — ground, ESC, CSI, SS3 and a string sequence (OSC and its
// relatives, which carry replies we do not act on) — plus a sixth for a bracketed paste, which is a
// state rather than a sequence because the bytes inside it are somebody's file and may contain
// anything, an ESC included. Nothing here reads a terminfo database: the only thing we know about
// this terminal is what it said back to the requests
// `./terminal.ts` made, and the one such answer worth keeping is `kittyAnswered`.
//
// **A partial sequence stays in the buffer and the buffer is the only state.** A terminal delivers a
// keystroke in one chunk almost always and in two occasionally, and a paste in as many as it likes,
// so every state has to survive a chunk boundary. `pending` holds bytes from the start of the
// sequence being read; a completed unit advances the cursor and everything before it is dropped at
// the end of the scan.
//
// **The lone-ESC timeout is 20 ms**, which is what OpenTUI's own parser waits: its
// `DEFAULT_TIMEOUT_MS` is 20 and its renderer passes `timeoutMs: 20` explicitly at 0.5.9. An ESC byte
// is the first byte of every escape sequence there is, so pressing Escape and pressing Down are the
// same first byte and only time tells them apart. A terminal that answered the kitty request sends
// `CSI 27 u` for the Escape key and never a bare ESC, which is the ambiguity that flag exists to
// settle (docs/tui.md § The adapter) — but the wait stays armed either way, because a byte that
// arrives late is a byte we have to do something with.

/** How long a lone ESC waits for the rest of its sequence. OpenTUI's number, above. */
export const ESC_TIMEOUT_MS = 20

const ESC = 0x1b

/** A sequence longer than this is not a sequence. Terminals send parameters in tens of bytes; a run
 *  of hundreds is a stream out of step, and holding it forever would wedge every key after it. */
const MAX_SEQUENCE = 256

/** An unterminated paste is dropped once it passes this. A paste is bounded by what a person put on
 *  their clipboard, so the cap is generous, but unbounded would be a way to run this process out of
 *  memory with a terminal that lost its closing bracket. */
const MAX_PASTE = 4 * 1024 * 1024

type State = 'ground' | 'esc' | 'csi' | 'ss3' | 'string' | 'paste'

export type Parser = {
  /** Bytes as they arrive. Emits every whole event they contain, in order. */
  push: (bytes: Uint8Array) => void
  /** The wait is over: a lone ESC is the Escape key and an unfinished sequence is noise. Called by
   *  the timer this parser arms, and directly by a test that would rather not wait 20 ms. */
  flushTimeout: () => void
  /** Did this terminal answer the kitty keyboard request? Reported rather than obeyed — see the
   *  comment on `decodeKitty` for why the parse cannot be gated on it. */
  kittyAnswered: () => boolean
  /** Forget a half-read sequence. For a caller that has just taken the terminal back and given it
   *  again, and for a test that wants a clean machine. */
  reset: () => void
  /** Stop the timer. Nothing else holds a resource. */
  close: () => void
}

export type ParserOptions = {
  /** Overrides the 20 ms above. For the terminal to raise over a slow link, and for nothing else. */
  timeoutMs?: number
}

const utf8 = new TextDecoder()

/** How many bytes this UTF-8 lead byte promises. Anything that is not a lead byte counts as one, so a
 *  stray continuation byte is consumed rather than stalling the scan forever. */
function utf8Length(byte: number): number {
  if (byte < 0x80) return 1
  if (byte >= 0xf0) return 4
  if (byte >= 0xe0) return 3
  if (byte >= 0xc0) return 2
  return 1
}

/** An xterm or kitty modifier parameter, which is a bitmask plus one. The bits are the kitty
 *  protocol's and xterm's first four agree with them, so one function reads both. */
function modifiersOf(param: number | undefined): Modifiers {
  const mask = (param ?? 1) - 1
  if (mask < 1) return NO_MODIFIERS
  return {
    shift: (mask & 1) !== 0,
    alt: (mask & 2) !== 0,
    ctrl: (mask & 4) !== 0,
    super: (mask & 8) !== 0,
  }
}

/** The kitty event type: 1 press, 2 repeat, 3 release. Absent means press, which is what every
 *  legacy sequence is. */
function actionOf(param: number | undefined): KeyAction {
  if (param === 2) return 'repeat'
  if (param === 3) return 'release'
  return 'press'
}

const BUTTONS: readonly MouseButton[] = ['left', 'middle', 'right', 'none']
const WHEEL: readonly WheelDirection[] = ['up', 'down', 'left', 'right']

export function createParser(
  emit: (event: InputEvent) => void,
  options: ParserOptions = {},
): Parser {
  const timeoutMs = options.timeoutMs ?? ESC_TIMEOUT_MS
  let pending: number[] = []
  // Where the sequence being read starts, and how far into it we have got. Both survive a chunk
  // boundary, because a terminal is free to deliver `ESC [ 6 ~` in four writes and every state here
  // has to be able to be resumed rather than restarted.
  let unit = 0
  let cursor = 0
  let state: State = 'ground'
  let kitty = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const key = (name: string, text: string, modifiers: Modifiers, action: KeyAction = 'press'): void => {
    emit({ type: 'key', name, text, action, ...modifiers })
  }

  // A character key. The name is lower case with the case carried by `shift`, because that is how
  // `intentKeys` spells `shift+g`, and a name of `G` would be a binding nothing matches.
  const character = (char: string, modifiers: Modifiers): void => {
    const lower = char.toLowerCase()
    const shifted = lower !== char
    const name = char === ' ' ? 'space' : lower
    // A chord types nothing. Alt with a letter is a chord even on a keyboard where Option would
    // otherwise compose a character, because a terminal that sends ESC first has already decided.
    const types = !modifiers.ctrl && !modifiers.alt && !modifiers.super
    key(name, types ? char : '', { ...modifiers, shift: modifiers.shift || shifted })
  }

  /** Ground state: one key, or nothing yet because a multi-byte character is half here. Returns the
   *  bytes consumed, and zero for "come back when there is more". */
  function ground(at: number, modifiers: Modifiers): number {
    const byte = pending[at]
    if (byte === undefined) return 0

    const named = CONTROL_KEYS[byte]
    if (named !== undefined) {
      key(named, '', modifiers)
      return 1
    }
    // Ctrl and a letter, which a terminal sends as the letter's position in the alphabet. The four
    // control characters above are checked first because three of them are inside this range.
    if (byte === 0) {
      key('space', '', { ...modifiers, ctrl: true })
      return 1
    }
    if (byte < 0x1b) {
      key(String.fromCharCode(byte + 0x60), '', { ...modifiers, ctrl: true })
      return 1
    }
    if (byte > 0x1b && byte < 0x20) {
      key(String.fromCharCode(byte + 0x40), '', { ...modifiers, ctrl: true })
      return 1
    }

    const width = utf8Length(byte)
    if (at + width > pending.length) return 0
    const bytes = pending.slice(at, at + width)
    character(utf8.decode(new Uint8Array(bytes)), modifiers)
    return width
  }

  /** The parameters of a CSI or SS3 sequence: fields split on `;`, each with its own sub-fields split
   *  on `:`, every one a number or undefined. Kitty puts the event type in a sub-field of the
   *  modifier field, which is the only reason the second level exists. */
  function fields(body: string): number[][] {
    return body.split(';').map((field) => field.split(':').map((part) => {
      const value = Number.parseInt(part, 10)
      return Number.isNaN(value) ? -1 : value
    }))
  }

  const at = (parsed: number[][], field: number, sub = 0): number | undefined => {
    const value = parsed[field]?.[sub]
    return value === undefined || value < 0 ? undefined : value
  }

  /** Kitty's `CSI <codepoint>[:shifted:base];<modifiers>[:<event>];<text> u`.
   *
   *  **Decoded whenever it arrives, not only once the terminal has answered the query.** The phase
   *  design gates this on the answer, and a gate here cannot fail safe: a terminal that speaks the
   *  protocol but leaves the query unanswered would have every key it sends this way dropped, and
   *  those keys include Escape. Nothing else in any terminal's vocabulary ends a CSI sequence with
   *  `u`, so the sequence arriving *is* the answer — and it says so, which is what `kittyAnswered`
   *  reports for whoever needs to know whether a release is possible at all. */
  function decodeKitty(body: string): void {
    kitty = true
    const parsed = fields(body)
    const code = at(parsed, 0)
    if (code === undefined) return
    const modifiers = modifiersOf(at(parsed, 1))
    const action = actionOf(at(parsed, 1, 1))

    const named = KITTY_KEYS[code]
    if (named !== undefined) {
      key(named, KITTY_TEXT[named] ?? '', modifiers, action)
      return
    }
    // The associated text the terminal reports, when we asked for it and it has some. Otherwise the
    // key's own character, which is the unshifted codepoint, with the shifted one preferred when
    // Shift is down: kitty reports `g` and `G` as one key and a modifier.
    const reported = parsed[2]?.filter((point) => point > 0) ?? []
    const shifted = at(parsed, 0, 1)
    const char = String.fromCodePoint(modifiers.shift && shifted !== undefined ? shifted : code)
    const typed = reported.length > 0 ? String.fromCodePoint(...reported) : char
    const types = !modifiers.ctrl && !modifiers.alt && !modifiers.super
    key(char === ' ' ? 'space' : char.toLowerCase(), types ? typed : '', modifiers, action)
  }

  /** SGR mouse: `CSI < <code>;<column>;<row> M` for a press and `m` for a release. The code carries
   *  the button in its low two bits, the modifiers above them, motion at 32 and the wheel at 64. */
  function decodeMouse(body: string, final: string): void {
    const parsed = fields(body.slice(1))
    const code = at(parsed, 0)
    const column = at(parsed, 1)
    const row = at(parsed, 2)
    if (code === undefined || column === undefined || row === undefined) return

    const modifiers: Modifiers = {
      shift: (code & 4) !== 0,
      alt: (code & 8) !== 0,
      ctrl: (code & 16) !== 0,
      super: false,
    }
    // One-based on the wire and zero-based here, so a position indexes the cell buffer directly.
    const x = Math.max(0, column - 1)
    const y = Math.max(0, row - 1)
    const low = code & 3

    if ((code & 64) !== 0) {
      const wheel = WHEEL[low] ?? 'up'
      emit({ type: 'mouse', x, y, button: 'none', action: 'wheel', wheel, ...modifiers })
      return
    }
    // Motion, with or without a button held. Which button is dragging is the hit test's business in
    // phase 3, and it knows because it saw the press.
    const action: MouseAction = (code & 32) !== 0
      ? 'move'
      : (final === 'M' ? 'press' : 'release')
    // A low field of 3 means "no button", which is the old encoding's release and a bare move here.
    const button = action === 'move' && low === 3 ? 'none' : (BUTTONS[low] ?? 'none')
    emit({ type: 'mouse', x, y, button, action, ...modifiers })
  }

  /** A whole CSI sequence: the bytes between `CSI` and its final byte, and the final byte. */
  function decodeCsi(body: string, final: string): void {
    if (body.startsWith('<')) {
      if (final === 'M' || final === 'm') decodeMouse(body, final)
      return
    }
    if (final === 'u') {
      // The kitty query's own reply, `CSI ? <flags> u`. The flags say what the terminal agreed to;
      // we asked for what we need and there is nothing to negotiate, so only the fact is kept.
      if (body.startsWith('?')) {
        kitty = true
        return
      }
      decodeKitty(body)
      return
    }
    if (final === 'I' || final === 'O') {
      if (body === '') emit({ type: 'focus', state: final === 'I' ? 'in' : 'out' })
      return
    }
    if (final === '~') {
      const parsed = fields(body)
      const code = at(parsed, 0)
      if (code === undefined) return
      // Bracketed paste opens here and closes in the paste state, which reads raw bytes.
      if (code === 200) {
        state = 'paste'
        return
      }
      if (code === 201) return
      const named = TILDE_KEYS[code]
      if (named === undefined) return
      key(named, '', modifiersOf(at(parsed, 1)), actionOf(at(parsed, 1, 1)))
      return
    }
    const named = LETTER_KEYS[final]
    if (named === undefined) return
    // A body that is not the usual `1;<modifiers>` is a reply wearing a cursor key's final byte —
    // `CSI 1;1 R` is a position report — so only the shape we asked for is read as a key.
    const parsed = body === '' ? [] : fields(body)
    if (parsed.length > 0 && at(parsed, 0) !== 1) return
    const modifiers = modifiersOf(at(parsed, 1))
    key(named, '', final === 'Z' ? { ...modifiers, shift: true } : modifiers, actionOf(at(parsed, 1, 1)))
  }

  /** `SS3 <letter>`: the keypad, and the cursor keys in application mode. */
  function decodeSs3(final: string): void {
    const typed = SS3_TEXT[final]
    if (typed !== undefined) {
      key(typed, typed, NO_MODIFIERS)
      return
    }
    const named = SS3_ONLY[final] ?? LETTER_KEYS[final]
    if (named !== undefined) key(named, '', NO_MODIFIERS)
  }

  /** The end of a bracketed paste, as the six bytes it is. */
  const PASTE_END = [0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e]

  function endsPaste(upto: number, floor: number): boolean {
    const start = upto - PASTE_END.length
    // Never before the content began, so the six bytes of the *opening* bracket cannot be read as a
    // closing one on a paste of nothing.
    if (start < floor) return false
    return PASTE_END.every((byte, index) => pending[start + index] === byte)
  }

  const clearTimer = (): void => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  const armTimer = (): void => {
    if (state === 'ground' || state === 'paste') {
      clearTimer()
      return
    }
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      flushTimeout()
    }, timeoutMs)
    // A held sequence must not be the reason this process stays alive. There is nothing to wait for
    // if the app is otherwise finished.
    timer.unref?.()
  }

  /** Read as much of `pending` as makes whole events. Returns with the buffer holding only what is
   *  still incomplete, and the cursor still inside it. */
  function scan(): void {
    reading: while (cursor < pending.length) {
      switch (state) {
        case 'ground': {
          if (pending[cursor] === ESC) {
            state = 'esc'
            cursor += 1
            break
          }
          const used = ground(cursor, NO_MODIFIERS)
          if (used === 0) break reading
          cursor += used
          unit = cursor
          break
        }

        case 'esc': {
          const byte = pending[cursor]
          if (byte === undefined) break reading
          if (byte === 0x5b) {
            state = 'csi'
            cursor += 1
            break
          }
          if (byte === 0x4f) {
            state = 'ss3'
            cursor += 1
            break
          }
          // OSC, DCS, PM and APC: a string terminated by BEL or ST, carrying a reply to a question we
          // did not ask. Read to the end and dropped, because the alternative is reading it as keys.
          if (byte === 0x5d || byte === 0x50 || byte === 0x5e || byte === 0x5f) {
            state = 'string'
            cursor += 1
            break
          }
          // Two ESC bytes in a row. The first was the Escape key — a reader pressing it twice is how
          // you leave a modal and then a panel, and the second press often lands inside the wait for
          // the first — and this one leads whatever comes next, so the state does not change.
          if (byte === ESC) {
            key('escape', '', NO_MODIFIERS)
            unit = cursor
            cursor += 1
            break
          }
          // Anything else after ESC is that key with Alt held, which is how a terminal without the
          // kitty protocol says Alt at all.
          const used = ground(cursor, { ...NO_MODIFIERS, alt: true })
          if (used === 0) break reading
          cursor += used
          unit = cursor
          state = 'ground'
          break
        }

        case 'csi':
        case 'ss3': {
          const byte = pending[cursor]
          if (byte === undefined) break reading
          // SS3 takes exactly one byte; CSI takes parameters and intermediates until a final byte in
          // 0x40 to 0x7e.
          const final = state === 'ss3' || (byte >= 0x40 && byte <= 0x7e)
          if (!final) {
            cursor += 1
            if (cursor - unit > MAX_SEQUENCE) {
              state = 'ground'
              unit = cursor
            }
            break
          }
          const body = String.fromCharCode(...pending.slice(unit + 2, cursor))
          const was = state
          state = 'ground'
          if (was === 'csi') decodeCsi(body, String.fromCharCode(byte))
          else decodeSs3(String.fromCharCode(byte))
          cursor += 1
          // The paste state starts inside `decodeCsi`, and its content begins after this byte.
          unit = cursor
          break
        }

        case 'string': {
          const byte = pending[cursor]
          if (byte === undefined) break reading
          cursor += 1
          const bel = byte === 0x07
          const st = byte === 0x5c && pending[cursor - 2] === ESC
          if (bel || st || cursor - unit > MAX_SEQUENCE) {
            state = 'ground'
            unit = cursor
          }
          break
        }

        case 'paste': {
          cursor += 1
          if (endsPaste(cursor, unit)) {
            const content = pending.slice(unit, cursor - PASTE_END.length)
            state = 'ground'
            emit({ type: 'paste', text: utf8.decode(new Uint8Array(content)) })
            unit = cursor
            break
          }
          if (cursor - unit > MAX_PASTE) {
            state = 'ground'
            unit = cursor
          }
          break
        }
      }
    }

    // Everything before the sequence in progress is spent, and in ground state that is everything.
    if (unit === 0) return
    pending = pending.slice(unit)
    cursor -= unit
    unit = 0
  }

  function flushTimeout(): void {
    clearTimer()
    if (state === 'ground' || state === 'paste') return
    // A lone ESC waited its 20 ms and nothing followed, so it was the key. An unfinished CSI or SS3
    // is a sequence that was cut off, and there is nothing to do with half of one but forget it.
    if (state === 'esc' && pending.length === 1) key('escape', '', NO_MODIFIERS)
    state = 'ground'
    pending = []
    unit = 0
    cursor = 0
  }

  return {
    push: (bytes) => {
      clearTimer()
      for (const byte of bytes) pending.push(byte)
      scan()
      armTimer()
    },
    flushTimeout,
    kittyAnswered: () => kitty,
    reset: () => {
      clearTimer()
      pending = []
      unit = 0
      cursor = 0
      state = 'ground'
    },
    close: clearTimer,
  }
}
