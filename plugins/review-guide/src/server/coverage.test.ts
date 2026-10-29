import { describe, expect, it } from 'vitest'
import type { DiffItem } from '../shared/guide'
import { checkCoverage } from './coverage'

const item = (id: string): DiffItem => ({ id, path: id.split('#')[0]!, oldPath: null, patch: `@@ ${id}`, note: '' })
const items = ['a.ts#1', 'a.ts#2', 'b.ts#1', 'c.ts#1'].map(item)
const section = (title: string, hunks: string[]) => ({ title, why: `Why ${title}`, kind: 'core' as const, hunks })

describe('checkCoverage', () => {
  it('keeps a complete answer as the harness ordered it', () => {
    const guide = checkCoverage(
      { summary: 'S', sections: [section('One', ['b.ts#1', 'a.ts#2']), section('Two', ['a.ts#1', 'c.ts#1'])] },
      items,
    )
    expect(guide.sections.map((s) => s.items.map((i) => i.id))).toEqual([
      ['b.ts#1', 'a.ts#2'],
      ['a.ts#1', 'c.ts#1'],
    ])
    expect(guide).toMatchObject({ summary: 'S', uncovered: [], repeated: 0, unknown: 0 })
  })

  it('puts left-out items last, in file order', () => {
    const guide = checkCoverage({ summary: '', sections: [section('One', ['b.ts#1'])] }, items)
    expect(guide.uncovered.map((i) => i.id)).toEqual(['a.ts#1', 'a.ts#2', 'c.ts#1'])
  })

  it('keeps a repeated item in its first section and counts it', () => {
    const guide = checkCoverage(
      { summary: '', sections: [section('One', ['a.ts#1', 'a.ts#1']), section('Two', ['a.ts#1', 'b.ts#1'])] },
      items,
    )
    expect(guide.sections.map((s) => s.items.map((i) => i.id))).toEqual([['a.ts#1'], ['b.ts#1']])
    expect(guide.repeated).toBe(2)
  })

  it('drops and counts unknown IDs, and drops a section left empty', () => {
    const guide = checkCoverage(
      { summary: '', sections: [section('Ghost', ['z.ts#9']), section('Real', ['a.ts#1', 'a.ts#7'])] },
      items,
    )
    expect(guide.sections.map((s) => s.title)).toEqual(['Real'])
    expect(guide.unknown).toBe(2)
  })

  it('shows every item exactly once whatever the answer', () => {
    const guide = checkCoverage(
      { summary: '', sections: [section('One', ['c.ts#1', 'x#1', 'c.ts#1']), section('Two', ['a.ts#2'])] },
      items,
    )
    const shown = [...guide.sections.flatMap((s) => s.items), ...guide.uncovered].map((i) => i.id)
    expect(shown.sort()).toEqual(items.map((i) => i.id).sort())
  })
})
