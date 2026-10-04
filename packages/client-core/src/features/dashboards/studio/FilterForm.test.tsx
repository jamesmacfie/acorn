import { afterEach, describe, expect, it } from 'vitest'
import { dataSourceDescriptionSchema } from '@acorn/protocol/dataSources.ts'
import { formPlan, mountStageForm } from '../../../testkit/stageForms'
import FilterForm from './FilterForm'
import { DATE_PRESETS, newComparison } from './stageFormParts'

const description = (viewerMatch?: string) => dataSourceDescriptionSchema.parse({
  schema: { type: 'object', properties: { author: { type: 'string' }, reviewer: { type: 'string' } } },
  fields: [
    { pointer: '/author', label: 'Author', origin: 'declared', display: { kind: 'person' }, ...(viewerMatch ? { viewerMatch } : {}) },
    { pointer: '/reviewer', label: 'Reviewer', origin: 'declared', display: { kind: 'person' } },
  ],
  parameters: { type: 'object' }, parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  revision: 'fixture', consistency: 'fixture records',
})
const columns = formPlan({ op: 'filter', where: newComparison(undefined) }).columns
const onColumn = (id: string) => formPlan({ op: 'filter', where: newComparison(columns.find(column => column.id === id)) })

let form: ReturnType<typeof mountStageForm<'filter'>> | undefined
afterEach(() => { form?.dispose(); form = undefined })

describe('FilterForm', () => {
  it('writes a typed value for each kind of column', () => {
    form = mountStageForm(FilterForm, onColumn('title'))
    form.type('Value', 'auth')
    expect(form.stage().where).toMatchObject({ kind: 'comparison', operator: 'eq', right: { address: { from: 'literal', value: 'auth' } } })
    form.choose('Column', 'Changed lines')
    form.choose('Comparison', 'is more than')
    form.type('Value', '200')
    expect(form.stage().where).toMatchObject({ left: { address: { pointer: '/size' } }, operator: 'gt', right: { address: { value: 200 } } })
    form.choose('Column', 'State')
    expect(form.options('Value')).toEqual(['Open', 'Closed'])
    form.choose('Value', 'Closed')
    expect(form.stage().where).toMatchObject({ left: { address: { pointer: '/state' } }, right: { address: { value: 'closed' } } })
  })

  it('offers comparisons that fit the column', () => {
    form = mountStageForm(FilterForm, onColumn('created'))
    expect(form.options('Comparison')).toEqual(['is after', 'is before', 'is empty', 'has a value'])
    form.choose('Column', 'Labels')
    expect(form.options('Comparison')).toEqual(['contains', 'is empty', 'has a value'])
    form.choose('Comparison', 'is empty')
    expect(form.has('Value')).toBe(false)
    expect(form.stage().where).not.toHaveProperty('right')
  })

  it('offers You only for a field that declares viewerMatch', () => {
    form = mountStageForm(FilterForm, onColumn('author'), { pulls: description('/login') })
    expect(form.options('Person')).toEqual(['You', 'Someone else'])
    form.choose('Person', 'You')
    expect(form.stage().where).toMatchObject({ right: { address: { from: 'context', name: 'viewer', pointer: '/login' } } })
    form.choose('Column', 'Reviewer')
    expect(form.has('Person')).toBe(false)
    expect(form.has('Value')).toBe(true)
    form.dispose()
    form = mountStageForm(FilterForm, onColumn('author'), { pulls: description() })
    expect(form.has('Person')).toBe(false)
  })

  it('writes each date preset as its context address, and a specific date as a day', () => {
    form = mountStageForm(FilterForm, onColumn('created'))
    expect(form.options('Date')).toEqual(['Today', 'Start of this week', 'Start of this month', '7 days ago', '30 days ago', '90 days ago', 'A specific date'])
    const expected = {
      Today: { from: 'context', name: 'calendar', boundary: 'startOfDay' },
      'Start of this week': { from: 'context', name: 'calendar', boundary: 'startOfWeek' },
      'Start of this month': { from: 'context', name: 'calendar', boundary: 'startOfMonth' },
      '7 days ago': { from: 'context', name: 'now', offset: '-P7D' },
      '30 days ago': { from: 'context', name: 'now', offset: '-P30D' },
      '90 days ago': { from: 'context', name: 'now', offset: '-P90D' },
    }
    expect(DATE_PRESETS.map(preset => preset.label)).toEqual(Object.keys(expected))
    for (const [label, address] of Object.entries(expected)) {
      form.choose('Date', label)
      expect(form.stage().where).toMatchObject({ right: { address } })
    }
    form.choose('Date', 'A specific date')
    form.type('Day', '2026-10-05')
    expect(form.stage().where).toMatchObject({ right: { address: { from: 'literal', value: new Date('2026-10-05T00:00:00').getTime() } } })
  })

  it('keeps a stored relative date that is not a preset', () => {
    form = mountStageForm(FilterForm, formPlan({ op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/created' } }, operator: 'gt',
      right: { address: { from: 'context', name: 'calendar', boundary: 'startOfWeek', offset: '-P1W' } } } }))
    expect(form.options('Date')).toContain('The start of the week 1 week ago')
  })

  it('matches all or any of two conditions, and goes back to one', () => {
    form = mountStageForm(FilterForm, onColumn('title'))
    expect(form.text()).not.toContain('Match all of these')
    form.press('Add condition')
    expect(form.stage().where).toMatchObject({ kind: 'all', predicates: [{ kind: 'comparison' }, { kind: 'comparison' }] })
    form.press('Match any of these')
    expect(form.stage().where.kind).toBe('any')
    form.press('Remove condition')
    expect(form.stage().where.kind).toBe('comparison')
  })

  it('shows a deeper stored predicate in words', () => {
    const comparison = newComparison(undefined)
    form = mountStageForm(FilterForm, formPlan({ op: 'filter', where: { kind: 'all', predicates: [{ kind: 'any', predicates: [{ ...comparison, left: { address: { from: 'item', pointer: '/title' } } }] }] } }))
    expect(form.text()).toContain('Edit this in the Plan tab or with AI.')
    expect(form.has('Column')).toBe(false)
  })
})
