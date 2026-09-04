import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { setHostFocused } from '@acorn/client-core/features/notifications/deliver.ts'
import { installKeymap } from './keys/install'
import { _resetRegions } from './keys/regions'
import { openTerminal, type TerminalInput, type TerminalOutput } from './input/terminal'
import { openOwnRenderer, type OwnRenderer } from './ownRenderer'

// What the terminal says, arriving where the app listens for it.
//
// The one case that matters here is the first, and it is the whole reason this file exists. Our enter
// sequence asks the kitty keyboard protocol for event reporting, which `./main.tsx` has never asked
// for: OpenTUI's `useKittyKeyboard: { disambiguate: true }` builds flags 1 and 4 and never 2, so no
// terminal has ever sent this app a key release. Now every key arrives twice on a terminal that
// speaks the protocol, once as a press and once as a release, and a subscription that does not split
// them fires every binding twice and types every character twice
// (./input/terminal.ts § KITTY_FLAGS, ./keys/install.ts § typeInto).
//
// Bytes in rather than events constructed, because the split is the routing's and a test that pushed
// two events onto the queue itself would be testing its own arithmetic.

/** Anything can push bytes at this, which is all `openTerminal` wants of stdin. */
const fakeStdin = (): TerminalInput & EventEmitter => {
  const stdin = new EventEmitter() as EventEmitter & TerminalInput
  stdin.setRawMode = () => {}
  stdin.resume = () => {}
  stdin.pause = () => {}
  stdin.isTTY = true
  return stdin
}

/** And a stdout that keeps what was written, so the enter and leave sequences can be read back. */
const fakeStdout = (written: string[]): TerminalOutput => ({
  write: (text) => { written.push(text) },
  columns: 80,
  rows: 24,
})

type Wired = {
  stdin: EventEmitter
  renderer: OwnRenderer
  written: string[]
  close: () => void
}

/** A screen at 80 by 24 with a terminal under it, wired the way `openOwnSurface` wires the real one. */
const wire = (): Wired => {
  const stdin = fakeStdin()
  const written: string[] = []
  const terminal = openTerminal({ stdin, stdout: fakeStdout(written) })
  const renderer = openOwnRenderer({
    cols: 80,
    rows: 24,
    write: () => {},
    closeTerminal: terminal.close,
    listen: terminal.on,
  })
  return { stdin, renderer, written, close: () => renderer.destroy() }
}

const send = (stdin: EventEmitter, text: string): void => {
  stdin.emit('data', new TextEncoder().encode(text))
}

afterEach(() => {
  _resetRegions()
  setHostFocused(null)
})

describe('the terminal, wired to the dispatcher', () => {
  it('presses one key once, whatever the protocol sends about it', async () => {
    const { stdin, renderer, close } = wire()
    const engine = installKeymap(renderer as unknown as OwnRenderer)
    let intents = 0
    let presses = 0
    let releases = 0
    renderer.keyInput.on('keypress', (() => { presses += 1 }) as () => void)
    renderer.keyInput.on('keyrelease', (() => { releases += 1 }) as () => void)
    const stop = engine.registerLayer({ bindings: [{ key: 'j', cmd: () => { intents += 1; return true } }] })
    try {
      // A kitty terminal with event reporting on, saying `j` down and then `j` up: the code point,
      // no modifiers, and the event type after the colon (./input/parser.test.ts § reads press,
      // release and repeat).
      send(stdin, '\x1b[106;1u')
      send(stdin, '\x1b[106;1:3u')
      expect(presses, 'a release was delivered as a press').toBe(1)
      expect(releases, 'the release went nowhere').toBe(1)
      expect(intents, 'one key press fired the binding more than once').toBe(1)

      // And a repeat is a press, because holding a key down is meant to repeat the intent.
      send(stdin, '\x1b[106;1:2u')
      expect(intents).toBe(2)
    } finally {
      stop()
      close()
    }
  })

  it('takes a paste whole, and tells the app when the window loses the reader', () => {
    const { stdin, renderer, close } = wire()
    const pastes: string[] = []
    const focus: string[] = []
    renderer.keyInput.on('paste', ((event: { text: string }) => { pastes.push(event.text) }) as () => void)
    renderer.on('focus', (() => { focus.push('in') }) as () => void)
    renderer.on('blur', (() => { focus.push('out') }) as () => void)
    try {
      // Bracketed, so a hundred lines are one event rather than a hundred Returns
      // (./input/events.ts § PasteEvent).
      send(stdin, '\x1b[200~one\ntwo\x1b[201~')
      expect(pastes).toEqual(['one\ntwo'])
      // DEC 1004, which is the difference between a notice that lands read and one that raises a
      // banner. Under the two names OpenTUI's renderer raised them by, because `./main.tsx`
      // subscribes to those (§ route).
      send(stdin, '\x1b[O')
      send(stdin, '\x1b[I')
      expect(focus).toEqual(['out', 'in'])
    } finally {
      close()
    }
  })

  it('gives the terminal back on the way out', () => {
    // The pops matter more than the pushes: a process that leaves mouse reporting on hands the reader
    // a shell that prints `<35;80;24M` when they move the mouse (./input/terminal.ts).
    const { written, close } = wire()
    expect(written.join('')).toContain('\x1b[?1049h')
    close()
    expect(written.join('')).toContain('\x1b[?1049l')
  })
})
