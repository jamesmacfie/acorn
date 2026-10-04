import { afterEach, describe, expect, it } from 'vitest'
import { formPlan, mountStageForm } from '../../../testkit/stageForms'
import SummarizeForm from './SummarizeForm'

const count = formPlan({ op: 'summarize', by: [], measures: [{ id: 'count', label: 'Count', kind: 'count' }] })

let form: ReturnType<typeof mountStageForm<'summarize'>> | undefined
afterEach(() => { form?.dispose(); form = undefined })

describe('SummarizeForm', () => {
  it('groups by columns, a date by a period', () => {
    form = mountStageForm(SummarizeForm, count)
    form.press('Add column')
    form.choose('Column', 'Created')
    expect(form.stage().by).toEqual([{ column: 'created', bucket: 'day' }])
    form.choose('By', 'Week')
    form.press('Add column')
    form.choose('Column', 'State', 1)
    expect(form.stage().by).toEqual([{ column: 'created', bucket: 'week' }, { column: 'state' }])
  })

  it('offers fill and previous-period change only with a date period', () => {
    form = mountStageForm(SummarizeForm, count)
    form.open('More options')
    expect(form.has('Show as share of the total')).toBe(true)
    expect(form.has('Fill empty periods')).toBe(false)
    expect(form.has('Change from the previous period')).toBe(false)
    form.press('Add column')
    form.choose('Column', 'Created')
    expect(form.has('Fill empty periods')).toBe(true)
    form.choose('Change from the previous period', 'As a percentage')
    expect(form.stage().measures[0]).toMatchObject({ previous: 'ratio' })
  })

  it('asks for a column only when the measure reads one, of a type it can read', () => {
    form = mountStageForm(SummarizeForm, count)
    expect(form.has('Of')).toBe(false)
    form.choose('Calculate', 'Total')
    expect(form.options('Of')).toEqual(['Changed lines'])
    expect(form.stage().measures[0]).toMatchObject({ kind: 'sum', column: 'size' })
    form.choose('Calculate', 'Latest')
    expect(form.options('Of')).toEqual(['Created', 'Merged'])
    form.choose('Calculate', 'Percentile')
    expect(form.stage().measures[0]).toMatchObject({ kind: 'percentile', column: 'size', percentile: 95 })
  })

  it('counts matching rows with a condition', () => {
    form = mountStageForm(SummarizeForm, count)
    form.choose('Calculate', 'Count matching')
    form.choose('Column', 'State')
    form.choose('Value', 'Open')
    expect(form.stage().measures[0]).toMatchObject({ kind: 'count-where', where: { left: { address: { pointer: '/state' } }, right: { address: { value: 'open' } } } })
  })

  it('makes a new measure id from its label, and splits into columns by a choice', () => {
    form = mountStageForm(SummarizeForm, count)
    form.press('Add measure')
    expect(form.stage().measures[1]!.id).toBe('count2')
    form.choose('Split into columns by', 'State')
    expect(form.stage()).toMatchObject({ by: [{ column: 'state' }], pivot: { column: 'state', measure: 'count' } })
  })
})
