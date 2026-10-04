import { afterEach, describe, expect, it } from 'vitest'
import { formPlan, mountStageForm } from '../../../testkit/stageForms'
import ComputeForm from './ComputeForm'

const age = formPlan({ op: 'compute', columns: [{ id: 'age', label: 'Age', type: 'number', expression: { kind: 'duration', start: { kind: 'column', column: 'created' }, end: { kind: 'clock', name: 'now' }, unit: 'days' } }] })

let form: ReturnType<typeof mountStageForm<'compute'>> | undefined
afterEach(() => { form?.dispose(); form = undefined })

describe('ComputeForm', () => {
  it('fills an expression from each template', () => {
    form = mountStageForm(ComputeForm, age)
    expect(form.options('Calculation').slice(0, 6)).toEqual(['Time between', 'Arithmetic', 'By choice', 'First value that exists', 'Smallest of', 'Largest of'])
    form.choose('Calculation', 'Arithmetic')
    form.choose('First value', 'Changed lines')
    form.choose('Operation', 'Times')
    form.type('Number for second value', '2')
    expect(form.stage().columns[0]).toMatchObject({ type: 'number', expression: { kind: 'arithmetic', operator: 'multiply', left: { kind: 'column', column: 'size' }, right: { kind: 'literal', value: 2 } } })
    form.choose('Calculation', 'By choice')
    form.type('Open', 'Waiting')
    form.type('Otherwise', 'Done')
    expect(form.stage().columns[0]).toMatchObject({ type: 'text', expression: { kind: 'choice', column: 'state', cases: { open: 'Waiting' }, otherwise: 'Done' } })
    form.choose('Calculation', 'Largest of')
    form.press('Add value')
    expect(form.stage().columns[0]!.expression).toMatchObject({ kind: 'max', values: [{}, {}, {}] })
  })

  it('times between two dates in the unit picked', () => {
    form = mountStageForm(ComputeForm, age)
    form.choose('To', 'Merged')
    form.choose('In', 'Hours')
    expect(form.stage().columns[0]!.expression).toEqual({ kind: 'duration', start: { kind: 'column', column: 'created' }, end: { kind: 'column', column: 'merged' }, unit: 'hours' })
  })

  it('nests one calculation inside another, and shows a deeper one in words', () => {
    form = mountStageForm(ComputeForm, age)
    form.choose('To', 'Arithmetic')
    expect(form.has('Operation')).toBe(true)
    expect(form.options('First value')).not.toContain('Arithmetic')
    form.dispose()
    const deep = { kind: 'arithmetic' as const, operator: 'add' as const, left: { kind: 'column' as const, column: 'size' }, right: { kind: 'literal' as const, value: 1 } }
    form = mountStageForm(ComputeForm, formPlan({ op: 'compute', columns: [{ id: 'total', label: 'Total', expression: { ...deep, left: { ...deep, left: deep } } }] }))
    expect(form.text()).toContain('First value: (Changed lines plus 1).')
    expect(form.text()).toContain('Edit this in the Plan tab or with AI.')
  })

  it('makes a new calculation id from its label and keeps it through a rename', () => {
    form = mountStageForm(ComputeForm, age)
    form.press('Add calculation')
    expect(form.stage().columns[1]).toMatchObject({ id: 'calculatedValue', label: 'Calculated value' })
    form.type('Name', 'Review time', 1)
    expect(form.stage().columns[1]).toMatchObject({ id: 'calculatedValue', label: 'Review time' })
    form.press('Add calculation')
    expect(form.stage().columns[2]!.id).toBe('calculatedValue2')
    expect(form.text()).not.toContain('calculatedValue')
  })
})
