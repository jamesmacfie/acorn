import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import { layoutTree } from '../layout/pass'
import { createElement, createTextNode, insertNode, replaceText, setProperty } from '../tree/renderer'
import type { Node } from '../tree/node'
import { ATTRS, bufferLines, cellAt, createBuffer } from './buffer'
import { openScreen, type Screen } from './screen'
import { paint } from './paint'

// The paint pass, on its own. No OpenTUI anywhere in this file, so it runs on the Node the repo pins
// with no FFI and no flag — which is also why every case here builds its tree by hand rather than
// rendering a component: what is under test is the walk, the clip and the diff, and a component would
// only be a slower way to make a box.

/** A node with its props set and its children attached, in one expression. */
function el(kind: string, props: Record<string, unknown> = {}, children: Node[] = []): Node {
  const node = createElement(kind)
  for (const [name, value] of Object.entries(props)) setProperty(node, name, value)
  for (const child of children) insertNode(node, child)
  return node
}

/** A box of a known size, which is what a case hangs off: the root has to have a size for the tree
 *  under it to be a proportion of anything. */
const boxOf = (width: number, height: number, props: Record<string, unknown> = {}, children: Node[] = []): Node =>
  el('box', { width, height, ...props }, children)

/** Lay a tree out and paint it, and read the cells back as lines. */
function drawn(root: Node, cols: number, rows: number): string[] {
  const buffer = createBuffer(cols, rows)
  layoutTree(root, cols, rows)
  paint(root, buffer)
  return bufferLines(buffer)
}

/** A screen with its writes collected instead of sent, which is the whole of what a test terminal is
 *  (docs/future/terminal-rewrite/architecture.md § 7). */
function screenOf(cols: number, rows: number): { screen: Screen; writes: string[] } {
  const writes: string[] = []
  const screen = openScreen({ cols, rows, write: (text) => writes.push(text) })
  return { screen, writes }
}

const cursorMoves = (text: string): string[] => text.match(/\x1b\[\d+;\d+H/g) ?? []

describe('a box', () => {
  it('draws four edges with corners, and its caption in the top one', () => {
    const box = boxOf(12, 3, { border: true, title: 'Keys' })
    expect(drawn(box, 12, 3)).toEqual([
      '┌─Keys─────┐',
      '│          │',
      '└──────────┘',
    ])
  })

  it('draws one edge and no corners for a rule', () => {
    // A `Rule` is one side of a box rather than a run of repeated characters, so the renderer draws it
    // to whatever length the layout gave it (../kit/cells.tsx § Rule). A corner is drawn only where
    // the two edges that meet it are both drawn, which is what keeps a divider a line.
    expect(drawn(boxOf(6, 1, { border: ['top'] }), 6, 1)).toEqual(['──────'])
    expect(drawn(boxOf(1, 3, { border: ['left'] }), 1, 3)).toEqual(['│', '│', '│'])
  })

  it('draws nothing where the role draws no box', () => {
    // `boxBorder` answers `false` for every border role but `surface`, and the box has to give the
    // cell back rather than keep drawing in it (../kit/roles.ts § boxBorder).
    expect(drawn(boxOf(4, 2, { border: false, title: 'gone' }), 4, 2)).toEqual(['    ', '    '])
  })

  it('keeps its background under a run of text', () => {
    // A run has no background of its own: it is drawn onto whatever the box beneath it laid down. If
    // it wrote one, a word on a highlighted row would punch a hole in the highlight.
    const buffer = createBuffer(6, 1)
    const box = boxOf(6, 1, { backgroundColor: 3 }, [el('text', {}, [createTextNode('ab')])])
    layoutTree(box, 6, 1)
    paint(box, buffer)
    expect(cellAt(buffer, 0, 0)).toMatchObject({ char: 'a', bg: 3 })
    expect(cellAt(buffer, 5, 0)).toMatchObject({ char: ' ', bg: 3 })
  })

  it('paints a loose run of text at its content origin', () => {
    // A `#text` directly under a `box` is legal here and draws as one default-styled line inside the
    // border. It used to throw from inside whatever signal had just moved, and four crashes in one
    // week were a bare `{count()}` under a `<Stack>` (../tree/renderer.ts).
    const box = boxOf(9, 3, { border: true }, [createTextNode('loose')])
    expect(drawn(box, 9, 3)).toEqual([
      '┌───────┐',
      '│loose  │',
      '└───────┘',
    ])
  })

  it('skips a hidden subtree whole', () => {
    // `visible === false` is skipped by paint and `DISPLAY_NONE` by Yoga, so the two agree without a
    // rule between them (../layout/props.ts § visible).
    const box = boxOf(5, 2, {}, [
      el('box', { visible: false }, [el('text', {}, [createTextNode('hidden')])]),
      el('text', {}, [createTextNode('shown')]),
    ])
    expect(drawn(box, 5, 2)).toEqual(['shown', '     '])
  })
})

describe('a run of text', () => {
  it('draws the lines its measure produced', () => {
    const text = el('text', { wrapMode: 'word' }, [createTextNode('one two three four')])
    const box = boxOf(9, 4, {}, [text])
    expect(drawn(box, 9, 4)).toEqual([
      'one two  ',
      'three    ',
      'four     ',
      '         ',
    ])
    // The rectangle and the run are two different widths, and paint needs both: the box is nine cells
    // because a column container stretches its children across, and the run is seven.
    expect(text.rect.w).toBe(9)
  })

  it('truncates rather than wrapping where the run says not to wrap', () => {
    const box = boxOf(6, 1, {}, [el('text', {}, [createTextNode('far too long for this')])])
    expect(drawn(box, 6, 1)).toEqual(['far to'])
  })

  it('clips a run that starts left of the screen rather than moving it', () => {
    // A computed left may be negative and the read-back leaves it alone, because clamping it to zero
    // would slide the run sideways where paint's job is to clip it (../layout/pass.ts). So the clip
    // has to be asked per cell: the clusters before column zero are dropped and the ones after it
    // land where they belong, which is what makes an overflowing row unreadable-but-aligned rather
    // than aligned-but-wrong.
    const inner = el('box', { width: 20, flexShrink: 0 }, [el('text', {}, [createTextNode('abcdefghijklmnopqrst')])])
    const box = boxOf(10, 1, { alignItems: 'center' }, [inner])
    const lines = drawn(box, 10, 1)

    expect(inner.rect.x).toBe(-5)
    expect(lines).toEqual(['fghijklmno'])
  })

  it('keeps a span its own colour inside a sentence', () => {
    // The `span` fault, from the other side: a colour handed to one was dropped in silence, so the
    // run inherited its parent's — and a parent given none drew opaque white, which on a light
    // terminal was every line of every diff (docs/future/terminal-rewrite/review.md § 2c). A span is
    // a stretch inside one `text` rather than a box of its own, so the line still wraps as one thing.
    const buffer = createBuffer(21, 1)
    const span = el('span', { style: { fg: 6, bold: true } }, [createTextNode('signIn')])
    const text = el('text', { fg: 8 }, [createTextNode('hash but '), span, createTextNode(' still')])
    const box = boxOf(21, 1, {}, [text])
    layoutTree(box, 21, 1)
    paint(box, buffer)

    expect(bufferLines(buffer)).toEqual(['hash but signIn still'])
    expect(cellAt(buffer, 0, 0)).toMatchObject({ char: 'h', fg: 8, attrs: 0 })
    expect(cellAt(buffer, 9, 0)).toMatchObject({ char: 's', fg: 6, attrs: ATTRS.bold })
    expect(cellAt(buffer, 16, 0)).toMatchObject({ char: 's', fg: 8, attrs: 0 })
  })

  it('styles each wrapped line from the span it came from', () => {
    // The line breaks come out of the measure cache and the styles out of the tree, so the two have
    // to be lined up again here — across the space the wrap consumed, which is in the run but on
    // neither line. If they ever disagreed, every wrapped paragraph with a styled word in it would
    // be a colour out from the line the word is on.
    const buffer = createBuffer(9, 3)
    const span = el('span', { fg: 2 }, [createTextNode('three')])
    const text = el('text', { wrapMode: 'word', fg: 1 }, [createTextNode('one two '), span, createTextNode(' four')])
    const box = boxOf(9, 3, {}, [text])
    layoutTree(box, 9, 3)
    paint(box, buffer)

    expect(bufferLines(buffer)).toEqual(['one two  ', 'three    ', 'four     '])
    expect(cellAt(buffer, 0, 0)).toMatchObject({ char: 'o', fg: 1 })
    expect(cellAt(buffer, 0, 1)).toMatchObject({ char: 't', fg: 2 })
    expect(cellAt(buffer, 0, 2)).toMatchObject({ char: 'f', fg: 1 })
  })
})

describe('a wide glyph', () => {
  it('takes two cells and flushes as one run', () => {
    // A wide glyph writes itself into its first cell and a continuation marker into its second, so
    // the diff and the flush treat the pair as one thing: the marker carries no character, and a run
    // that begins on one is widened left onto the glyph it belongs to.
    const { screen, writes } = screenOf(4, 1)
    try {
      insertNode(screen.root, el('text', {}, [createTextNode('漢a')]))
      screen.frame()

      expect(cellAt(screen.screen(), 0, 0)?.char).toBe('漢')
      expect(cellAt(screen.screen(), 1, 0)?.char).toBe('')
      expect(cellAt(screen.screen(), 2, 0)?.char).toBe('a')
      expect(screen.lines()).toEqual(['漢a '])
      expect(cursorMoves(writes.join(''))).toHaveLength(1)
    } finally {
      screen.close()
    }
  })
})

describe('a field', () => {
  it('is a cell tall and does not shrink, without either being spelled', () => {
    // `InputRenderable`'s constructor hands `height: 1` to the textarea it extends, so a field is a
    // cell tall whatever is in it — and the height decides a second thing, because a numeric one is
    // what `../layout/props.ts § flexShrinkFor` reads as "does not shrink". Neither can be a JSX
    // attribute: `InputRenderableOptions` omits `height` outright (../tree/node.ts § INTRINSIC).
    const field = el('input', { value: 'a much longer value than fits' })
    expect(drawn(boxOf(8, 3, {}, [field]), 8, 3)).toEqual(['a much l', '        ', '        '])
    expect(field.rect.h).toBe(1)
    expect(field.yoga?.getFlexShrink()).toBe(0)
  })

  it('slides one row sideways and a wrapped one up, off the same prop', () => {
    // One number, one meaning per kind, the way `offset` works on a viewport: cells for an `input`
    // whose row is wider than its box, rows for a `textarea` whose content is taller (§ drawField).
    const line = el('input', { value: 'abcdefghij', scroll: 4 })
    expect(drawn(boxOf(4, 1, {}, [line]), 4, 1)).toEqual(['efgh'])
    const area = el('textarea', { value: 'one\ntwo\nthree\nfour', scroll: 2, flexGrow: 1 })
    expect(drawn(boxOf(6, 2, {}, [area]), 6, 2)).toEqual(['three ', 'four  '])
  })

  it('draws its placeholder in the colour the kit named, and only while it is empty', () => {
    const hint = el('input', { placeholder: 'Find…', placeholderColor: 8, value: '' })
    const buffer = createBuffer(8, 1)
    const root = boxOf(8, 1, {}, [hint])
    layoutTree(root, 8, 1)
    paint(root, buffer)
    expect(bufferLines(buffer)).toEqual(['Find…   '])
    // The slot rather than the `#666666` OpenTUI's own placeholder invents, which is none of the
    // sixteen a terminal has (../appearance.ts § TERMINAL_PALETTE).
    expect(cellAt(buffer, 0, 0)?.fg).toBe(8)
    setProperty(hint, 'value', 'x')
    expect(drawn(root, 8, 1)).toEqual(['x       '])
  })

  it('writes the terminal\'s caret where the focused field says, and hides it otherwise', () => {
    // The caret is the terminal's own rather than a cell of ours, so paint says where and the flush
    // says whether — and a frame with no field being typed into hides it, because a caret parked in
    // the corner of a list means nothing (./flush.ts § SHOW).
    const { screen, writes } = screenOf(10, 2)
    try {
      const field = el('input', { value: 'hello', cursor: 3, focused: true })
      insertNode(screen.root, field)
      screen.frame()
      expect(writes.join('')).toContain('\x1b[1;4H\x1b[?25h')

      // Moved, and only the move is written: the cells did not change.
      writes.length = 0
      setProperty(field, 'cursor', 5)
      screen.frame()
      expect(writes.join('')).toContain('\x1b[1;6H')

      // And gone with the keys.
      writes.length = 0
      setProperty(field, 'focused', false)
      screen.frame()
      expect(writes.join('')).toContain('\x1b[?25l')

      // A frame that changed nothing writes nothing at all, caret included.
      writes.length = 0
      screen.frame()
      expect(writes).toEqual([])
    } finally {
      screen.close()
    }
  })
})

describe('a pty rectangle', () => {
  // A real emulator rather than a stand-in, because what is under test is the copy and a stand-in
  // would only be a second opinion about what xterm puts in a cell. `createRequire` for the reason
  // `../kit/rectangle.tsx` gives: the package ships one CommonJS bundle.
  const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as {
    Terminal: typeof HeadlessTerminal
  }

  /** An emulator of a known size with those bytes already parsed. xterm parses on a queue of its own,
   *  so the callback is what says the cells are there (../kit/rectangle.tsx § write). */
  const emulator = async (cols: number, rows: number, data: string): Promise<HeadlessTerminal> => {
    const term = new Terminal({ cols, rows, allowProposedApi: true })
    await new Promise<void>((parsed) => term.write(data, parsed))
    return term
  }

  it('copies the emulator\'s cells, colours and attributes into the rectangle', async () => {
    // Bold red on the palette's blue, then plain, which is what a shell prompt is made of. The
    // sixteen-slot forms stay slots, because that is what the reader's own theme fills in
    // (../colour.ts).
    const term = await emulator(12, 2, '\x1b[1;31;44mred\x1b[0m plain')
    const rect = el('pty', { terminal: term, flexGrow: 1 })
    const buffer = createBuffer(12, 2)
    const root = boxOf(12, 2, {}, [rect])
    layoutTree(root, 12, 2)
    paint(root, buffer)
    expect(bufferLines(buffer)).toEqual(['red plain   ', '            '])
    expect(cellAt(buffer, 0, 0)).toMatchObject({ char: 'r', fg: 1, bg: 4, attrs: ATTRS.bold })
    expect(cellAt(buffer, 4, 0)).toMatchObject({ char: 'p', fg: 'default', bg: 'default', attrs: 0 })
  })

  it('reads a 24-bit colour as a triple and a cube colour as the colour it is', async () => {
    // A `Color` has three answers and the 256-colour cube is none of them, so paint does the
    // arithmetic: 16 is the corner of the cube, which is black, and 226 is its yellow (§ paletteColor).
    const term = await emulator(6, 1, '\x1b[38;2;10;20;30ma\x1b[38;5;226mb')
    const rect = el('pty', { terminal: term, flexGrow: 1 })
    const buffer = createBuffer(6, 1)
    const root = boxOf(6, 1, {}, [rect])
    layoutTree(root, 6, 1)
    paint(root, buffer)
    expect(cellAt(buffer, 0, 0)?.fg).toEqual([10, 20, 30])
    expect(cellAt(buffer, 1, 0)?.fg).toEqual([255, 255, 0])
  })

  it('keeps a wide glyph and its second cell together', async () => {
    // The emulator says it the same way our buffer does: the glyph reports a width of two and the
    // cell after it reports no characters at all (./buffer.ts § A wide glyph is a pair).
    const term = await emulator(6, 1, '\u4f60x')
    const rect = el('pty', { terminal: term, flexGrow: 1 })
    const buffer = createBuffer(6, 1)
    const root = boxOf(6, 1, {}, [rect])
    layoutTree(root, 6, 1)
    paint(root, buffer)
    expect(cellAt(buffer, 0, 0)?.char).toBe('\u4f60')
    expect(cellAt(buffer, 1, 0)?.char).toBe('')
    expect(cellAt(buffer, 2, 0)?.char).toBe('x')
  })

  it('follows the emulator\'s own viewport rather than an offset of ours', async () => {
    // A rectangle's viewport is the rectangle, so there is no `scroll` prop here: the program inside
    // scrolls its own region and `viewportY` is where the emulator is showing from (§ drawPty).
    const term = await emulator(6, 2, 'one\r\ntwo\r\nthree\r\nfour')
    const rect = el('pty', { terminal: term, flexGrow: 1 })
    const buffer = createBuffer(6, 2)
    const root = boxOf(6, 2, {}, [rect])
    layoutTree(root, 6, 2)
    paint(root, buffer)
    expect(bufferLines(buffer)).toEqual(['three ', 'four  '])
  })

  it('draws the emulator\'s caret only while the rectangle is entered', async () => {
    // The second writer of the buffer's one caret, and the rule is the same: paint says where and the
    // flush says whether. At most one thing has the keys, so at most one of the two can be true
    // (§ drawField, ./flush.ts § SHOW).
    const term = await emulator(8, 2, 'ab')
    const { screen, writes } = screenOf(8, 2)
    try {
      const rect = el('pty', { terminal: term, flexGrow: 1, focused: true })
      insertNode(screen.root, rect)
      screen.frame()
      expect(writes.join('')).toContain('\x1b[1;3H\x1b[?25h')

      writes.length = 0
      setProperty(rect, 'focused', false)
      screen.frame()
      expect(writes.join('')).toContain('\x1b[?25l')
    } finally {
      screen.close()
    }
  })

  it('draws nothing at all before an emulator is on the node', () => {
    // The rectangle is a box for one frame: the component builds its emulator in the node's `ref`,
    // and a paint between the two would otherwise throw rather than draw an empty box.
    expect(drawn(boxOf(4, 1, {}, [el('pty', { flexGrow: 1 })]), 4, 1)).toEqual(['    '])
  })
})

describe('the flush', () => {
  it('writes one cursor move and one run for a one-cell change', () => {
    const { screen, writes } = screenOf(6, 1)
    try {
      const word = createTextNode('abc')
      insertNode(screen.root, el('text', {}, [word]))
      screen.frame()
      writes.length = 0

      replaceText(word, 'abd')
      const second = screen.frame()

      expect(second.runs).toBe(1)
      expect(cursorMoves(second.text)).toEqual(['\x1b[1;3H'])
      // Wrapped in synchronized output, so the emulator applies the frame in one go rather than
      // showing it being drawn.
      expect(second.text.startsWith('\x1b[?2026h')).toBe(true)
      expect(second.text.endsWith('\x1b[?2026l')).toBe(true)
      expect(writes).toEqual([second.text])
    } finally {
      screen.close()
    }
  })

  it('writes nothing at all when nothing moved', () => {
    const { screen, writes } = screenOf(6, 1)
    try {
      insertNode(screen.root, el('text', {}, [createTextNode('abc')]))
      screen.frame()
      writes.length = 0

      expect(screen.frame()).toEqual({ text: '', runs: 0 })
      expect(writes).toEqual([])
    } finally {
      screen.close()
    }
  })

  it('groups a row of changed cells into one run and leaves an unchanged gap alone', () => {
    // A gap costs a cursor move to skip and a couple of characters to draw through, and which is
    // cheaper depends on the gap. This one does not guess: a run is a stretch of cells that all
    // changed, and two stretches with anything unchanged between them are two runs.
    const { screen } = screenOf(9, 1)
    try {
      const left = createTextNode('ab')
      const right = createTextNode('yz')
      insertNode(screen.root, el('box', { flexDirection: 'row', gap: 3 }, [
        el('text', { flexShrink: 0 }, [left]),
        el('text', { flexShrink: 0 }, [right]),
      ]))
      screen.frame()

      replaceText(left, 'AB')
      replaceText(right, 'YZ')
      const second = screen.frame()

      expect(second.runs).toBe(2)
      expect(cursorMoves(second.text)).toEqual(['\x1b[1;1H', '\x1b[1;6H'])
    } finally {
      screen.close()
    }
  })

  it('names the terminal\'s own colours rather than a white of its own', () => {
    // The white-on-white class, fixed where the colour is emitted: `39` and `49` are the foreground
    // and the background the person's terminal already has, and there is no way to say that to
    // OpenTUI at all (../colour.ts).
    const { screen } = screenOf(3, 1)
    try {
      const text = el('text', { fg: 4 }, [createTextNode('abc')])
      insertNode(screen.root, text)
      expect(screen.frame().text).toContain('\x1b[34m')

      setProperty(text, 'fg', 12)
      expect(screen.frame().text).toContain('\x1b[94m')

      setProperty(text, 'fg', [10, 20, 30])
      const truecolor = screen.frame()
      expect(truecolor.text).toContain('\x1b[38;2;10;20;30m')

      // And a run that goes back to the terminal's own colour needs no sequence at all, because every
      // flush ends with `0m` and so begins from a known state. That is the point of the reset being
      // at the end rather than the start: an unchanged style can be left unsaid across frames as well
      // as within one.
      expect(truecolor.text).toContain('\x1b[0m')
      setProperty(text, 'fg', 'default')
      const plain = screen.frame()
      expect(plain.text).toContain('abc')
      expect(plain.text).not.toMatch(/\x1b\[\d+(?:;\d+)*m/)
    } finally {
      screen.close()
    }
  })

  it('sets and clears the four attributes the kit asks for', () => {
    // Three runs in one frame, because a reset is only ever needed inside a flush: the flush that
    // came before ended at the terminal's default.
    const { screen } = screenOf(3, 1)
    try {
      insertNode(screen.root, el('box', { flexDirection: 'row', gap: 0 }, [
        el('text', { attributes: ATTRS.bold | ATTRS.underline, flexShrink: 0 }, [createTextNode('a')]),
        el('text', { attributes: ATTRS.dim, flexShrink: 0 }, [createTextNode('b')]),
        el('text', { flexShrink: 0 }, [createTextNode('c')]),
      ]))
      const written = screen.frame().text

      expect(written).toContain('\x1b[1;4m')
      // Bold and dim share the reset `22`, so clearing one clears the other and the survivor has to
      // be said again. It is the one place this vocabulary is not symmetrical.
      expect(written).toContain('\x1b[22;2;24m')
      expect(written).toContain('\x1b[22m')
    } finally {
      screen.close()
    }
  })

  it('clears the display and redraws everything after a resize', () => {
    const { screen } = screenOf(6, 2)
    try {
      insertNode(screen.root, el('text', {}, [createTextNode('abcdef')]))
      screen.frame()
      expect(screen.lines()).toEqual(['abcdef', '      '])

      screen.resize(4, 1)
      // Both buffers are cleared, because every index in them meant something else a moment ago.
      expect(screen.lines()).toEqual(['    '])

      const after = screen.frame()
      expect(after.text).toContain('\x1b[2J')
      expect(screen.lines()).toEqual(['abcd'])
    } finally {
      screen.close()
    }
  })
})

describe('the frame scheduler', () => {
  it('coalesces a burst of writes into one frame', async () => {
    // One frame per turn of the event loop at most, which is what makes a signal write that touches
    // twenty nodes cost one paint rather than twenty (../tree/frames.ts).
    const { screen, writes } = screenOf(8, 1)
    try {
      const word = createTextNode('a')
      insertNode(screen.root, el('text', {}, [word]))
      replaceText(word, 'ab')
      replaceText(word, 'abc')
      expect(writes).toEqual([])

      await new Promise((resolve) => setImmediate(resolve))
      expect(writes).toHaveLength(1)
      expect(screen.lines()).toEqual(['abc     '])
    } finally {
      screen.close()
    }
  })
})
