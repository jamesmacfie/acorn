import { describe, expect, it } from 'vitest'
import { clusterWidth, graphemes, sliceToWidth, stringWidth } from './width'

// The corpus that chose the measure in `./width.ts`, held as the column it chose. Every row here was
// checked against `string-width` and `@xterm/headless`, so a change to the table that moves one of
// these has to be argued against those answers rather than against a preference.

describe('the width measure', () => {
  it('counts one cell per character on the ASCII fast path', () => {
    // The fixture's strings are ASCII, which is why the drawing tests don't depend on this choice and
    // don't catch the cases below.
    expect(stringWidth('Draft the release notes')).toBe(23)
    expect(stringWidth('')).toBe(0)
    expect(stringWidth(' ')).toBe(1)
    expect(stringWidth('~')).toBe(1)
  })

  it('gives the six glyphs OpenTUI drew two cells wide the width the standard gives them', () => {
    // Some renderers widen the astral pictographs whatever East Asian Width says, over 279 contiguous
    // code points. We take the answer xterm, `string-width` and the standard agree on, because an
    // xterm-measured rectangle draws on the same screen as these.
    expect(stringWidth('🗀')).toBe(1)
    expect(stringWidth('🗎')).toBe(1)
    expect(stringWidth('🖵')).toBe(1)
    expect(stringWidth('🗒')).toBe(1)
    expect(stringWidth('🗃')).toBe(1)
    // The one that goes the other way. Unicode 16 moved U+2630 to `W`, so the standard and our table
    // say two cells and any terminal with an older width table draws one. It is a glyph whose width
    // the layout cannot predict.
    expect(stringWidth('☰')).toBe(2)
  })

  it('does not double the seven glyphs `string-width` doubles', () => {
    // `string-width` asks `emoji-regex` before it looks at East Asian Width, and that regex matches a
    // bare text-presentation emoji.
    for (const glyph of ['▶', '☑', '⚠', '⌨', '☺', '👁', '🏷']) {
      expect(stringWidth(glyph), glyph).toBe(1)
    }
  })

  it('counts a combining mark as nothing and keeps it with its base', () => {
    // Clusters, not code points: a cell per code point draws an accented name a column too wide per
    // mark and clobbers the cell beside it. Spelled with combining acutes rather than the precomposed
    // letters, because that is the shape real data arrives in.
    const accented = 'Jose\u0301 Marti\u0301nez'
    expect(accented.length).toBe(15)
    expect(stringWidth(accented)).toBe(13)
    expect(stringWidth('e\u0327\u0301')).toBe(1)
    expect(stringWidth('\u0301')).toBe(0)
    // A cluster, not a code point: truncating at 4 keeps the acute with the `e` it belongs to.
    expect(sliceToWidth(accented, 4)).toEqual({ text: 'Jose\u0301', width: 4 })
  })

  it('measures Devanagari and a flag as clusters', () => {
    expect(stringWidth('नमस्ते')).toBe(3)
    expect(graphemes('नमस्ते')).toEqual(['न', 'म', 'स्ते'])
    // A regional-indicator pair is one cluster and neither indicator is East Asian wide, so one cell.
    expect(stringWidth('🇳🇿')).toBe(1)
  })

  it('counts the box and block characters the kit draws every frame at one cell', () => {
    // The eleven characters a `single` border draws, the two `Meter` fills, and the five pie
    // quarters. If any of these ever measured two, every bordered panel in the app would be a cell
    // narrower than its frame.
    for (const glyph of [...'─│┌┐└┘├┤┬┴┼', ...'█░', ...'○◔◑◕●']) expect(stringWidth(glyph), glyph).toBe(1)
  })

  it('gives a wide base two cells and slices before it rather than through it', () => {
    expect(clusterWidth('你')).toBe(2)
    expect(stringWidth('你好')).toBe(4)
    expect(stringWidth('你|')).toBe(3)
    // Three cells of room and a two-cell cluster next: the prefix is a cell narrower than the limit,
    // which is why `sliceToWidth` hands back the width it reached as well as the text.
    expect(sliceToWidth('你好', 3)).toEqual({ text: '你', width: 2 })
    expect(sliceToWidth('你好', 4)).toEqual({ text: '你好', width: 4 })
    expect(sliceToWidth('你好', 0)).toEqual({ text: '', width: 0 })
  })

  it('counts a control character as nothing', () => {
    expect(stringWidth('\u0007')).toBe(0)
    expect(stringWidth('a\u0000b')).toBe(2)
  })
})
