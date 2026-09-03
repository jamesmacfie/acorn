import { describe, expect, it } from 'vitest'
import { GLYPHS } from './kit/glyphs'
import { clusterWidth, graphemes, sliceToWidth, stringWidth } from './width'

// The corpus is spike 3's, held as the column it chose. Every row here was measured against what
// OpenTUI actually drew, `string-width`, and `@xterm/headless`
// (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md § Spike 3), so a change to the table
// in `./width.ts` that moves one of these is a change that has to be argued against those three
// answers rather than against a preference.
//
// No OpenTUI anywhere in this file, so it runs on the Node the repo pins with no flag.

describe('the width measure', () => {
  it('counts one cell per character on the ASCII fast path', () => {
    // Every one of the fixture's twenty strings is ASCII, which is why the goldens do not depend on
    // this choice at all and why nobody has seen the faults below.
    expect(stringWidth('Draft the release notes')).toBe(23)
    expect(stringWidth('')).toBe(0)
    expect(stringWidth(' ')).toBe(1)
    expect(stringWidth('~')).toBe(1)
  })

  it('gives the six glyphs OpenTUI drew two cells wide the width the standard gives them', () => {
    // OpenTUI widens the astral pictographs whatever East Asian Width says, over 279 contiguous code
    // points. We take the answer xterm, `string-width` and the standard agree on, because phase 3
    // puts an xterm-measured rectangle on the same screen as these.
    expect(stringWidth('🗀')).toBe(1) // archive, folder, folder-plus, folder-tree, folder-x
    expect(stringWidth('🗎')).toBe(1) // file-text, file-diff, file-cog
    expect(stringWidth('🖵')).toBe(1) // monitor, app-window
    expect(stringWidth('🗒')).toBe(1) // notepad-text
    expect(stringWidth('🗃')).toBe(1) // database
    // The one that goes the other way. Unicode 16 moved U+2630 to `W`, so the standard and our table
    // say two cells and any terminal with an older width table draws one. It is the glyph whose width
    // the layout cannot predict, and the slice that owns `kit/glyphs.ts` replaces it.
    expect(stringWidth('☰')).toBe(2) // list
  })

  it('does not double the seven glyphs `string-width` doubles', () => {
    // `string-width` asks `emoji-regex` before it looks at East Asian Width, and that regex matches a
    // bare text-presentation emoji. These seven carry nine names, and they are on the rail, the
    // footer and half the rows in the app.
    for (const glyph of ['▶', '☑', '⚠', '⌨', '☺', '👁', '🏷']) {
      expect(stringWidth(glyph), glyph).toBe(1)
    }
  })

  it('is one cell for every glyph in the table but `list`', () => {
    // The assertion the comment at the top of `kit/glyphs.ts` should always have been: it claims every
    // glyph is one cell wide and tests that claim with `\p{Emoji_Presentation}`, which passes all 73
    // names and misses all six wide ones. This is the check that catches a seventh. `list` is the one
    // still failing the rule, and it fails here on purpose until the slice that owns that file swaps
    // the character.
    const wide = Object.entries(GLYPHS).filter(([, glyph]) => stringWidth(glyph) !== 1)
    expect(wide.map(([name]) => name)).toEqual(['list'])
  })

  it('counts a combining mark as nothing and keeps it with its base', () => {
    // OpenTUI's two answers disagree here: its layout measures clusters and its paint writes a cell
    // per code point, so an accented name draws a column too wide per mark and clobbers the cell
    // beside it. We take the layout answer, which is the one both spike candidates gave.
    // Spelled with combining acutes rather than the precomposed letters, because that is the shape
    // real data arrives in and the shape OpenTUI's paint wrote a cell per code point of.
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
    // OpenTUI laid this out at 2 and painted it at 4.
    expect(stringWidth('🇳🇿')).toBe(1)
  })

  it('counts the box and block characters the kit draws every frame at one cell', () => {
    // The eleven characters a `single` border draws, and the two `Meter` fills. If any of these ever
    // measured two, every bordered panel in the app would be a cell narrower than its frame.
    for (const glyph of [...'─│┌┐└┘├┤┬┴┼', ...'█░']) expect(stringWidth(glyph), glyph).toBe(1)
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
