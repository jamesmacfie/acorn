/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { hasFfi } from '../ffi'
import { renderCells } from '../kit/render'
import { Modal, ModalBody } from '../kit/grouping'
import { Rectangle } from '../kit/pixels'
import type { CellTerminal } from '../kit/rectangle'
import { Row, Rows } from '../kit/showing'
import { Text } from '../kit/showing'
import { HeaderBodyFooter } from '../layouts/HeaderBodyFooter'

// The terminal twin of `client-core/host/keys/keys.test.tsx`: the same intent scenarios against the
// terminal adapter, so the two adapters cannot drift.
//
// A cell host has no tree to query, so a scenario is written as "press this, look at the screen".
// That is stricter than asking the DOM which element has focus, and it is the same discipline the
// kit's own suite keeps.

const LIST = [
  { key: 'one', label: 'Alpha' },
  { key: 'two', label: 'Bravo' },
  { key: 'three', label: 'Charlie' },
]

/** Which line the caret is on. The caret is where the keys are, so this is the whole assertion for
 *  every move intent. */
const caretRow = (lines: string[]) => lines.findIndex((line) => line.includes('›'))

function List(props: { onActivate?: (key: string) => void }) {
  return (
    <Rows id="test-list" items={LIST} {...(props.onActivate ? { onActivate: props.onActivate } : {})}>
      {(item, itemProps) => <Row item={itemProps}>{item.label}</Row>}
    </Rows>
  )
}

describe.skipIf(!hasFfi)('keys and focus in cells', () => {
  it('lands the keys on the list when a pane opens, and moves them with next and prev', async () => {
    const frame = await renderCells(() => (
      <HeaderBodyFooter stateKey="pane" label="Test" regions={{ body: () => <List /> }} />
    ), { width: 40, height: 10 })
    try {
      // Something has the keys before anything is pressed: a terminal has no pointer, so a pane that
      // opens with focus nowhere is a pane nobody can drive (./regions.ts § regionFocus).
      const first = caretRow(frame.lines)
      expect(first).toBeGreaterThanOrEqual(0)

      // `j` is `next` in the one table both hosts read (client-core kit/keys/keymap.ts).
      expect(caretRow((await frame.press('j')).lines)).toBe(first + 1)
      expect(caretRow((await frame.press('k')).lines)).toBe(first)
      // Wraps, because a list you cannot fall off the end of is a list you never have to look at.
      expect(caretRow((await frame.press('k')).lines)).toBe(first + LIST.length - 1)
      // `g` is `first` and `shift+g` is `last`.
      expect(caretRow((await frame.press('g')).lines)).toBe(first)
    } finally {
      frame.done()
    }
  }, 30_000)

  it('routes activate to the row the caret is on', async () => {
    const [opened, setOpened] = createSignal('')
    const frame = await renderCells(() => (
      <>
        <HeaderBodyFooter stateKey="pane" label="Test" regions={{ body: () => <List onActivate={setOpened} /> }} />
        <Text>{`opened:${opened()}`}</Text>
      </>
    ), { width: 40, height: 10 })
    try {
      await frame.press('j')
      const after = await frame.press('RETURN')
      expect(after.text).toContain('opened:two')
    } finally {
      frame.done()
    }
  }, 30_000)

  it('cycles the regions of a pane, and each remembers where it was', async () => {
    const frame = await renderCells(() => (
      <HeaderBodyFooter
        stateKey="pane"
        label="Test"
        regions={{
          header: () => <Rows id="header-list" items={[{ key: 'h', label: 'Header row' }]}>
            {(item, itemProps) => <Row item={itemProps}>{item.label}</Row>}
          </Rows>,
          body: () => <List />,
        }}
      />
    ), { width: 40, height: 10 })
    try {
      // The header registers first, so it opens with the keys.
      expect(frame.lines[caretRow(frame.lines)]).toContain('Header row')
      // `f6` is `nextRegion`, the platform convention, on layer 5 and global.
      const body = await frame.press('F6')
      expect(body.lines[caretRow(body.lines)]).toContain('Alpha')
      const back = await body.press('F6')
      expect(back.lines[caretRow(back.lines)]).toContain('Header row')
    } finally {
      frame.done()
    }
  }, 30_000)

  it('a modal swallows next from the pane below, and dismiss closes it', async () => {
    const [open, setOpen] = createSignal(true)
    const frame = await renderCells(() => (
      <>
        <HeaderBodyFooter stateKey="pane" label="Test" regions={{ body: () => <List /> }} />
        <Show when={open()}>
          <Modal onDismiss={() => setOpen(false)} title="Ask"><ModalBody><Text>a question</Text></ModalBody></Modal>
        </Show>
      </>
    ), { width: 40, height: 12 })
    try {
      const before = caretRow(frame.lines)
      // The trap sits above the collection tier, so the list behind it does not move
      // (./trap.ts). That is the whole meaning of modal on a host with no scrim.
      const held = await frame.press('F6')
      expect(caretRow(held.lines)).toBe(before)
      expect(held.text).toContain('a question')

      const closed = await frame.press('ESCAPE')
      expect(closed.text).not.toContain('a question')
      // And the pane has the keys back.
      expect(caretRow((await frame.press('j')).lines)).toBe(before + 1)
    } finally {
      frame.done()
    }
  }, 30_000)

  it('a pty rectangle takes the keys on enter and gives them back on escape', async () => {
    let terminal: CellTerminal | undefined
    const typed: string[] = []
    const frame = await renderCells(() => (
      <>
        <HeaderBodyFooter
          stateKey="pane"
          label="Test"
          regions={{
            header: () => <List />,
            body: () => <Rectangle kind="pty" label="Terminal" mount={(handle) => {
              terminal = handle as CellTerminal
              terminal.onData((bytes) => typed.push(new TextDecoder().decode(bytes)))
            }} />,
          }}
        />
      </>
    ), { width: 40, height: 20 })
    try {
      expect(terminal).toBeDefined()
      // Bytes from the PTY are drawn by a real emulator in cells, which is the thing a terminal does
      // better than the desktop (../kit/rectangle.tsx).
      terminal!.write('hello from the shell')
      expect((await frame.frame()).text).toContain('hello from the shell')

      // The header registers first, so the list opens with the keys and `j` is its.
      const before = caretRow(frame.lines)
      expect(caretRow((await frame.press('j')).lines)).toBe(before + 1)

      // The rectangle is one stop from outside; `f6` reaches it and Enter goes in.
      await frame.press('F6')
      const inside = await frame.press('RETURN')
      expect(inside.text).toContain('esc leave')

      // Inside, every key is the PTY's, including the ones the app would otherwise claim.
      await frame.press('j')
      await frame.press('F6')
      expect(typed.join('')).toContain('j')
      // The caret is gone from the list, because the keys are not the list's any more. That is the
      // visible half of the same fact.
      expect(caretRow((await frame.frame()).lines)).toBe(-1)

      // Escape alone leaves; Escape again goes back in and sends one through, which is how a reader
      // reaches vim's normal mode from in here (../kit/rectangle.tsx, ESCAPE_PAIR_MS).
      const out = await frame.press('ESCAPE')
      expect(out.text).toContain('\u00b7 enter')
      const again = await frame.press('ESCAPE')
      expect(again.text).toContain('esc leave')
      expect(typed.join('')).toContain('\u001b')

      // And the list has its place back when the keys come back to it, because a region remembers
      // where it was (./regions.ts).
      await frame.press('ESCAPE')
      const listed = await frame.press('F6')
      expect(caretRow(listed.lines)).toBe(before + 1)
    } finally {
      frame.done()
    }
  }, 30_000)

  it('a pty rectangle tells the PTY its size, and again when the terminal is resized', async () => {
    let terminal: CellTerminal | undefined
    const sizes: [number, number][] = []
    const frame = await renderCells(() => (
      <HeaderBodyFooter
        stateKey="pane"
        label="Test"
        regions={{
          body: () => <Rectangle kind="pty" label="Terminal" mount={(handle) => {
            terminal = handle as CellTerminal
            terminal.onResize((cols, rows) => sizes.push([cols, rows]))
          }} />,
        }}
      />
    ), { width: 40, height: 12 })
    try {
      expect(terminal).toBeDefined()
      await frame.resize(100, 30)
      // The renderer handles `SIGWINCH` itself and re-lays out; this is how that reaches the PTY, and
      // it is the only resize path there is (docs/future/terminal/03-process-model.md § Signals).
      expect(sizes.length).toBeGreaterThan(0)
      expect(sizes[sizes.length - 1][0]).toBeGreaterThan(40)
    } finally {
      frame.done()
    }
  }, 30_000)
})
