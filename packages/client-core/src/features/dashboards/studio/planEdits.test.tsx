import { describe, expect, it } from 'vitest'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import { describeSourceIn, retypeColumn, setColumnUnit } from './planEdits'
import { blankPlan } from './studioStore'

type Column = PanelPlan['columns'][number]

const withSource = (plan: PanelPlan, id: string): PanelPlan => ({
  ...plan,
  sources: [...plan.sources, { id, label: id, role: 'primary', reference: {} as QueryReference }],
})
const field = (id: string) =>
  ({ id, name: id.slice(1), type: 'text', role: 'title' }) as Parameters<typeof describeSourceIn>[2]['fields'][number]

describe('describeSourceIn', () => {
  it('fills a blank panel from its only source and takes the source name as the title', () => {
    const plan = describeSourceIn(withSource(blankPlan(), 'a'), 'a', {
      name: 'Issues',
      switched: false,
      fields: [field('/title')],
    })
    expect(plan.title).toBe('Issues')
    expect(plan.sources[0]?.label).toBe('Issues')
    expect(plan.columns.map((column) => column.bind)).toEqual([{ a: { field: '/title' } }])
  })

  it('leaves a panel with columns alone when nothing changed', () => {
    const plan = { ...withSource(blankPlan(), 'a'), columns: [{ id: 'c', label: 'C', bind: {} }] }
    expect(describeSourceIn(plan, 'a', { name: undefined, switched: false, fields: [] })).toBe(plan)
  })

  it('drops bindings a switched source cannot fill when the panel has several sources', () => {
    const column: Column = { id: 'c', label: 'C', type: 'number', bind: { a: { field: '/gone' }, b: { field: '/x' } } }
    const plan = { ...withSource(withSource(blankPlan(), 'a'), 'b'), columns: [column] }
    const next = describeSourceIn(plan, 'a', { name: 'A', switched: true, fields: [] })
    expect(next.columns[0]?.bind).toEqual({ b: { field: '/x' } })
  })
})

describe('column edits', () => {
  const money: Column = { id: 'm', label: 'M', type: 'number', unit: 'USD', bind: {} }

  it('keeps type settings only when the type is unchanged', () => {
    expect(retypeColumn(money, 'number').unit).toBe('USD')
    expect(retypeColumn(money, 'text')).toEqual({ id: 'm', label: 'M', type: 'text', bind: {} })
  })

  it('reads a unit column from the first other column', () => {
    const other: Column = { id: 'o', label: 'O', bind: {} }
    expect(setColumnUnit(money, 'column', [money, other]).unit).toEqual({ column: 'o' })
    expect(setColumnUnit(money, 'currency', []).unit).toBe('USD')
    expect('unit' in setColumnUnit(money, '', [])).toBe(false)
  })
})
