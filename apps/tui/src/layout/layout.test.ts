import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createElement,
  createTextNode,
  insertNode,
  replaceText,
  setProperty,
} from '../tree/renderer'
import { measureMisses, measuredRun, wrapLines } from './measure'
import { clampRect, layoutTree, readBack } from './pass'
import { NOT_YOGA, SETTERS } from './props'

// The layout pass, on its own. No OpenTUI anywhere in this file, so it runs on the Node the repo pins
// with no FFI and no flag.

/** A box of a known size to hang a case off. */
const root = (width: number, height: number) => {
  const box = createElement('box')
  setProperty(box, 'width', width)
  setProperty(box, 'height', height)
  return box
}

describe('the prop table', () => {
  it('has a setter or a reason for every prop the kit hands an intrinsic', () => {
    // Scanned rather than listed, because a list goes stale the day somebody adds a prop and a scan
    // does not. What it cannot see through is a spread — `{...boxBorder(...)}` and `{...run().style}`
    // — so the props those two helpers produce are named in the case below.
    const found = new Set<string>()
    for (const file of tsxUnder(join(import.meta.dirname, '..'))) {
      for (const name of propsOnIntrinsics(readFileSync(file, 'utf8'))) found.add(name)
    }
    // Anti-vacuity: a scan that found nothing would pass every assertion here.
    expect(found.size).toBeGreaterThan(20)
    const orphaned = [...found].filter((name) => !(name in SETTERS) && !(name in NOT_YOGA) && !name.startsWith('on'))
    expect(orphaned).toEqual([])
  })

  it('covers the props that only ever arrive through a spread', () => {
    // `roles.ts` § boxBorder and § textStyle are the two helpers whose whole output is spread onto an
    // intrinsic, so their keys never appear beside a tag for the scan above to find.
    for (const name of ['border', 'borderStyle', 'borderColor', 'fg', 'attributes', 'transform']) {
      expect(name in SETTERS || name in NOT_YOGA, name).toBe(true)
    }
  })

  it('maps the flex props the kit actually spends onto Yoga', () => {
    // The twenty-one with a setter, spelled out, so a rename of one of Yoga's setters fails here
    // rather than in a golden frame.
    const box = createElement('box')
    setProperty(box, 'flexDirection', 'row')
    setProperty(box, 'flexGrow', 1)
    setProperty(box, 'flexShrink', 20)
    setProperty(box, 'flexBasis', 0)
    setProperty(box, 'flexWrap', 'wrap')
    setProperty(box, 'alignItems', 'center')
    setProperty(box, 'overflow', 'hidden')
    setProperty(box, 'gap', 1)
    setProperty(box, 'width', '100%')
    setProperty(box, 'height', 3)
    setProperty(box, 'minWidth', 16)
    setProperty(box, 'minHeight', 2)
    setProperty(box, 'paddingLeft', 2)
    setProperty(box, 'marginTop', 1)

    const yoga = box.yoga!
    expect(yoga.getFlexDirection()).toBe(2) // Row
    expect(yoga.getFlexGrow()).toBe(1)
    expect(yoga.getFlexShrink()).toBe(20)
    expect(yoga.getFlexBasis()).toEqual({ unit: 1, value: 0 })
    expect(yoga.getFlexWrap()).toBe(1) // Wrap
    expect(yoga.getAlignItems()).toBe(2) // Center
    expect(yoga.getOverflow()).toBe(1) // Hidden
    expect(yoga.getGap(2)).toBe(1) // Gutter.All, which answers in cells rather than in a value
    expect(yoga.getWidth()).toEqual({ unit: 2, value: 100 }) // a percentage
    expect(yoga.getHeight()).toEqual({ unit: 1, value: 3 })
    expect(yoga.getMinWidth()).toEqual({ unit: 1, value: 16 })
    expect(yoga.getMinHeight()).toEqual({ unit: 1, value: 2 })
    expect(yoga.getPadding(0)).toEqual({ unit: 1, value: 2 }) // Edge.Left
    expect(yoga.getMargin(1)).toEqual({ unit: 1, value: 1 }) // Edge.Top
  })

  it('spends a cell of layout on each side a border draws', () => {
    // A `Rule` draws one side of a box, so `border` is an array as often as it is a boolean, and both
    // forms have to cost the layout what paint will spend. Read as computed rather than as style,
    // because `getBorder` answers `NaN` for an edge that was set through `Edge.All`.
    const box = root(40, 10)
    const edges = () => [0, 1, 2, 3].map((edge) => box.yoga!.getComputedBorder(edge))

    setProperty(box, 'border', true)
    layoutTree(box, 40, 10)
    expect(edges()).toEqual([1, 1, 1, 1])

    setProperty(box, 'border', ['left'])
    layoutTree(box, 40, 10)
    expect(edges()).toEqual([1, 0, 0, 0])

    // `boxBorder` returns `false` where the role draws no box, and the layout has to give the cell
    // back rather than keep charging for it.
    setProperty(box, 'border', false)
    layoutTree(box, 40, 10)
    expect(edges()).toEqual([0, 0, 0, 0])
  })
})

describe('the layout read-back', () => {
  it('lays a row out in whole cells that meet', () => {
    // Yoga rounds to whole cells itself at the default point scale factor of 1, so this is Yoga's own
    // answer rather than ours: 101 split three ways is 34, 33, 34 with no gap at the seams.
    const row = root(101, 1)
    setProperty(row, 'flexDirection', 'row')
    const thirds = [0, 1, 2].map(() => {
      const cell = createElement('box')
      setProperty(cell, 'flexGrow', 1)
      setProperty(cell, 'flexBasis', 0)
      insertNode(row, cell)
      return cell
    })
    layoutTree(row, 101, 1)

    expect(thirds.map((cell) => cell.rect.w)).toEqual([34, 33, 34])
    expect(thirds.map((cell) => cell.rect.x)).toEqual([0, 34, 67])
  })

  it('clamps the rectangle of a node that joined the tree after the pass', () => {
    // This is what `../renderGuard.ts` guarded, moved to the one place a rectangle is read. The fault
    // is Yoga's rather than OpenTUI's: an unmeasured node's computed width and height are `NaN`, and
    // it survives the move to wasm unchanged.
    const box = root(40, 10)
    insertNode(box, createElement('box'))
    layoutTree(box, 40, 10)

    const late = createElement('box')
    insertNode(box, late)
    // Unguarded, this is the number the painter would be handed.
    expect(late.yoga!.getComputedWidth()).toBeNaN()
    expect(late.yoga!.getComputedHeight()).toBeNaN()

    readBack(box)
    expect(late.rect).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    // A frame drawn at nothing is a frame nobody notices; the next pass has the real size.
    layoutTree(box, 40, 10)
    expect(late.rect.w).toBe(40)
  })

  it('keeps a negative left rather than moving the run', () => {
    // Measured: an overflowing child under `alignItems: center` reports left -15 at width 40 inside a
    // 10-cell parent. Clamping that to 0 would slide the run sideways; clipping it is paint's job, and
    // paint can only clip what it is told the truth about. So the invariant holds for the size half
    // only — four finite integers, of which the width and the height are non-negative.
    // A column, so `alignItems` centres across the width and the overflow is horizontal. The kit sets
    // `alignItems` once and `justifyContent` never, so this is a corner — but it is a corner the
    // clamp has to leave alone.
    const parent = root(10, 1)
    setProperty(parent, 'alignItems', 'center')
    const wide = createElement('box')
    setProperty(wide, 'width', 40)
    setProperty(wide, 'flexShrink', 0)
    insertNode(parent, wide)
    layoutTree(parent, 10, 1)

    expect(wide.rect.w).toBe(40)
    expect(wide.rect.x).toBeLessThan(0)
  })

  it('does not treat zero as a marker for unmeasured', () => {
    // Both of these legitimately read zero, which is why `Number.isFinite` and not `=== 0` is the
    // question the clamp asks: an empty auto-sized box, and a hidden subtree.
    expect(clampRect(0, 0, 0, 0)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    const box = root(40, 10)
    const hidden = createElement('box')
    setProperty(hidden, 'visible', false)
    setProperty(hidden, 'height', 4)
    const inside = createElement('box')
    setProperty(inside, 'height', 2)
    insertNode(hidden, inside)
    insertNode(box, hidden)
    layoutTree(box, 40, 10)

    // `DISPLAY_NONE`, so the subtree costs no layout — and paint skips `visible === false` for
    // itself, so the two agree without a rule between them.
    expect(hidden.rect).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    expect(inside.rect).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })

  it('offsets each rectangle by its parent, and passes a spanless origin through', () => {
    const box = root(40, 10)
    setProperty(box, 'paddingLeft', 2)
    setProperty(box, 'border', true)
    const text = createElement('text')
    insertNode(box, text)
    const span = createElement('span')
    insertNode(text, span)
    insertNode(span, createTextNode('inside'))
    layoutTree(box, 40, 10)

    // One cell of border plus two of padding.
    expect(text.rect.x).toBe(3)
    expect(text.rect.y).toBe(1)
    // A `span` has no Yoga node, so nothing wrote it a rectangle: where a run sits inside a line is
    // paint's to work out from the lines the measure function produced.
    expect(span.rect).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('the text measure', () => {
  it('wraps at words and breaks a word too long for the line', () => {
    expect(wrapLines('one two three four', 9, true)).toEqual(['one two', 'three', 'four'])
    expect(wrapLines('one two three four', 9, false)).toEqual(['one two three four'])
    expect(wrapLines('unwrappable', 4, true)).toEqual(['unwr', 'appa', 'ble'])
    expect(wrapLines('two\nlines', 40, true)).toEqual(['two', 'lines'])
    expect(wrapLines('', 40, true)).toEqual([''])
  })

  it('gives a wrapped run the height its lines need', () => {
    const box = root(9, 4)
    const text = createElement('text')
    setProperty(text, 'wrapMode', 'word')
    insertNode(box, text)
    insertNode(text, createTextNode('one two three four'))
    layoutTree(box, 9, 4)

    expect(text.rect.h).toBe(3)
    // The run itself is seven cells wide; the box is nine, because a column container stretches its
    // children across. The distinction matters to paint, which draws the run and clips to the box.
    expect(measuredRun(text, 9).width).toBe(7)
    expect(text.rect.w).toBe(9)
  })

  it('measures a run out of its `#text` and `span` children in order', () => {
    const text = createElement('text')
    insertNode(text, createTextNode('hash but '))
    const span = createElement('span')
    insertNode(text, span)
    insertNode(span, createTextNode('signIn'))
    insertNode(text, createTextNode(' still'))

    // One run, not three boxes. A row of independently shrunk `text` nodes is what turned "hash but
    // `signIn` still" into "hash bsignInstill" on the agents transcript.
    expect(measuredRun(text, Infinity).lines).toEqual(['hash but signIn still'])
  })

  it('hits the cache on an unchanged text and misses on a changed one', () => {
    const box = root(40, 4)
    const text = createElement('text')
    insertNode(box, text)
    const run = createTextNode('one two three')
    insertNode(text, run)

    layoutTree(box, 40, 4)
    const measured = measureMisses()
    expect(measured).toBeGreaterThan(0)

    // Dirty, so Yoga asks again, but the text and the width are the same — which is the case that
    // makes a frame where nothing moved cost nothing to measure.
    text.yoga!.markDirty()
    layoutTree(box, 40, 4)
    expect(measureMisses()).toBe(measured)

    replaceText(run, 'one two three four')
    layoutTree(box, 40, 4)
    expect(measureMisses()).toBeGreaterThan(measured)
  })
})

/** Every `.tsx` under a directory, recursively. */
function tsxUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return tsxUnder(path)
    return name.endsWith('.tsx') ? [path] : []
  })
}

const INTRINSICS = ['box', 'text', 'span', 'scrollbox', 'input', 'textarea']

/** The prop names written beside an intrinsic tag in one file.
 *
 *  Comments come out first — the prose in this package names props constantly — and anything inside
 *  braces is blanked, so a prop mentioned in an expression handed to another prop is not counted as
 *  one. */
function propsOnIntrinsics(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const names: string[] = []
  for (const tag of INTRINSICS) {
    for (const match of code.matchAll(new RegExp(`<${tag}(?=[\\s/>])`, 'g'))) {
      let at = match.index + match[0].length
      let depth = 0
      let attributes = ''
      while (at < code.length) {
        const character = code[at]!
        if (character === '{') depth += 1
        else if (character === '}') depth -= 1
        else if (character === '>' && depth === 0) break
        attributes += depth === 0 ? character : ' '
        at += 1
      }
      for (const prop of attributes.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)(?=\s*=)/g)) names.push(prop[1]!)
    }
  }
  return names
}
