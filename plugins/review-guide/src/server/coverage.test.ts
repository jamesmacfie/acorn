import { describe, expect, it } from 'vitest'
import type { DiffItem, GuideNote } from '../shared/guide'
import { checkCoverage } from './coverage'

const item = (id: string): DiffItem => ({ id, path: id.split('#')[0]!, oldPath: null, patch: `@@ ${id}`, note: '' })
const items = ['a.ts#1', 'a.ts#2', 'b.ts#1', 'c.ts#1'].map(item)
const step = (title: string, hunks: string[], notes: GuideNote[] = []) => ({
  title,
  why: `Why ${title}`,
  kind: 'core' as const,
  hunks,
  notes,
})

describe('checkCoverage', () => {
  it('keeps a complete answer as the harness ordered it', () => {
    const guide = checkCoverage(
      { summary: 'S', steps: [step('One', ['b.ts#1', 'a.ts#2']), step('Two', ['a.ts#1', 'c.ts#1'])] },
      items,
    )
    expect(guide.steps.map((s) => s.items.map((i) => i.id))).toEqual([
      ['b.ts#1', 'a.ts#2'],
      ['a.ts#1', 'c.ts#1'],
    ])
    expect(guide).toMatchObject({ summary: 'S', uncovered: [], repeated: 0, unknown: 0, misplacedNotes: 0 })
    expect(guide.steps[0]).toMatchObject({ title: 'One', notes: [] })
  })

  it('puts left-out items last, in file order', () => {
    const guide = checkCoverage({ summary: '', steps: [step('One', ['b.ts#1'])] }, items)
    expect(guide.uncovered.map((i) => i.id)).toEqual(['a.ts#1', 'a.ts#2', 'c.ts#1'])
  })

  it('keeps a repeated item in its first step and counts it', () => {
    const guide = checkCoverage(
      { summary: '', steps: [step('One', ['a.ts#1', 'a.ts#1']), step('Two', ['a.ts#1', 'b.ts#1'])] },
      items,
    )
    expect(guide.steps.map((s) => s.items.map((i) => i.id))).toEqual([['a.ts#1'], ['b.ts#1']])
    expect(guide.repeated).toBe(2)
  })

  it('drops and counts unknown IDs, and drops a step left empty', () => {
    const guide = checkCoverage(
      { summary: '', steps: [step('Ghost', ['z.ts#9']), step('Real', ['a.ts#1', 'a.ts#7'])] },
      items,
    )
    expect(guide.steps.map((s) => s.title)).toEqual(['Real'])
    expect(guide.unknown).toBe(2)
  })

  it("counts the notes of a dropped step, and passes a kept step's notes on to the note check", () => {
    const on = (hunk: string): GuideNote => ({
      hunk,
      side: 'new',
      line: 1,
      text: 'x',
      tone: 'risk',
      title: 'T',
      body: 'B',
    })
    const guide = checkCoverage(
      {
        summary: '',
        steps: [step('Ghost', ['z.ts#9'], [on('z.ts#9'), on('a.ts#1')]), step('Real', ['a.ts#1'], [on('a.ts#1')])],
      },
      items,
    )
    expect(guide.misplacedNotes).toBe(2)
    expect(guide.steps[0]!.notes).toEqual([on('a.ts#1')])
  })

  it('shows every item exactly once whatever the answer', () => {
    const guide = checkCoverage(
      { summary: '', steps: [step('One', ['c.ts#1', 'x#1', 'c.ts#1']), step('Two', ['a.ts#2'])] },
      items,
    )
    const shown = [...guide.steps.flatMap((s) => s.items), ...guide.uncovered].map((i) => i.id)
    expect(shown.sort()).toEqual(items.map((i) => i.id).sort())
  })
})
