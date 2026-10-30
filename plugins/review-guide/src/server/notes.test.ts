import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DiffItem, Guide, GuideNote } from '../shared/guide'
import { parseDiff } from './diff'
import { checkNotes } from './notes'

const ITEMS = parseDiff(readFileSync(new URL('./__fixtures__/change.diff', import.meta.url), 'utf8'))
const byId = (id: string) => ITEMS.find((item) => item.id === id)!

const note = (hunk: string, side: GuideNote['side'], line: number, text: string): GuideNote => ({
  hunk,
  side,
  line,
  text,
  tone: 'explain',
  title: `On ${text}`,
  body: 'Because.',
})

const guide = (...steps: { items: DiffItem[]; notes: GuideNote[] }[]): Guide => ({
  summary: '',
  steps: steps.map((step, index) => ({ title: `Step ${index}`, goal: '', why: '', kind: 'core', ...step })),
  uncovered: [],
  repeated: 0,
  unknown: 0,
  misplacedNotes: 0,
})

const placed = (checked: Guide) => checked.steps.map((step) => step.notes.map((n) => `${n.hunk}:${n.side}${n.line}`))

describe('checkNotes', () => {
  it('keeps a note on the line it quotes, on either side', () => {
    const checked = checkNotes(
      guide({
        items: [byId('src.txt#1'), byId('old.txt#1')],
        notes: [
          note('src.txt#1', 'new', 2, 'two'),
          note('src.txt#1', 'old', 2, '2'),
          note('old.txt#1', 'old', 1, 'gone'),
        ],
      }),
    )
    expect(placed(checked)).toEqual([['src.txt#1:new2', 'src.txt#1:old2', 'old.txt#1:old1']])
    expect(checked.misplacedNotes).toBe(0)
  })

  it('moves a misnumbered note to the only row with its text, ignoring trailing spaces', () => {
    const checked = checkNotes(
      guide({
        items: [byId('src.txt#2')],
        notes: [note('src.txt#2', 'new', 1, 'twenty-eight  '), note('src.txt#2', 'old', 99, '28')],
      }),
    )
    expect(placed(checked)).toEqual([['src.txt#2:new28', 'src.txt#2:old28']])
  })

  it('drops a note whose quote is missing, on the wrong side, or on more than one row', () => {
    const repeats: DiffItem = { ...byId('src.txt#1'), id: 'dup.txt#1', patch: '@@ -1,3 +1,3 @@\n }\n-a\n+b\n }' }
    const checked = checkNotes(
      guide({
        items: [byId('src.txt#1'), repeats],
        notes: [
          note('src.txt#1', 'new', 2, 'three'),
          note('src.txt#1', 'new', 2, '2'),
          // An unchanged row is on the new side only.
          note('src.txt#1', 'old', 1, '1'),
          note('dup.txt#1', 'new', 9, '}'),
        ],
      }),
    )
    expect(placed(checked)).toEqual([[]])
    expect(checked.misplacedNotes).toBe(4)
  })

  it("drops a note naming a hunk of another step, and adds to the coverage check's count", () => {
    const checked = checkNotes({
      ...guide(
        { items: [byId('src.txt#1')], notes: [note('src.txt#2', 'new', 28, 'twenty-eight')] },
        { items: [byId('src.txt#2')], notes: [] },
      ),
      misplacedNotes: 2,
    })
    expect(placed(checked)).toEqual([[], []])
    expect(checked.misplacedNotes).toBe(3)
  })

  it('keeps three notes a hunk and 40 a guide, in reading order', () => {
    const items = Array.from({ length: 14 }, (_, index): DiffItem => ({
      id: `f${index}.txt#1`,
      path: `f${index}.txt`,
      oldPath: null,
      patch: '@@ -0,0 +1,4 @@\n+a\n+b\n+c\n+d',
      note: '',
    }))
    const notes = items.flatMap((item) =>
      ['a', 'b', 'c', 'd'].map((text, line) => note(item.id, 'new', line + 1, text)),
    )
    const checked = checkNotes(
      guide({ items: items.slice(0, 7), notes: notes.slice(0, 28) }, { items: items.slice(7), notes: notes.slice(28) }),
    )
    const kept = checked.steps.flatMap((step) => step.notes)
    expect(kept).toHaveLength(40)
    expect(kept.filter((n) => n.hunk === 'f0.txt#1').map((n) => n.text)).toEqual(['a', 'b', 'c'])
    expect(kept.at(-1)).toMatchObject({ hunk: 'f13.txt#1', text: 'a' })
    expect(checked.misplacedNotes).toBe(56 - 40)
  })

  it('cuts a long title or body at the last word that fits', () => {
    const long = { ...note('added.txt#1', 'new', 1, 'new'), title: `${'word '.repeat(30)}end`, body: 'x'.repeat(700) }
    const [kept] = checkNotes(guide({ items: [byId('added.txt#1')], notes: [long] })).steps[0]!.notes
    expect(kept!.title).toBe('word '.repeat(24).trimEnd())
    expect(kept!.body).toBe('x'.repeat(600))
  })
})
