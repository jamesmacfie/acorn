import { afterEach, describe, expect, it } from 'vitest'
import { formPlan, mountStageForm } from '../../../testkit/stageForms'
import ExpandForm from './ExpandForm'

let form: ReturnType<typeof mountStageForm<'expand'>> | undefined
afterEach(() => { form?.dispose(); form = undefined })

describe('ExpandForm', () => {
  it('lists only list columns and writes a bounded count per row', () => {
    form = mountStageForm(ExpandForm, formPlan({ op: 'expand', column: 'labels', output: 'labelsItem', perRow: 100 }))
    expect(form.options('List column')).toEqual(['Labels'])
    form.type('At most per row', '10')
    expect(form.stage()).toEqual({ op: 'expand', column: 'labels', output: 'labelsItem', perRow: 10 })
    form.type('At most per row', '')
    expect(form.stage().perRow).toBe(10)
  })
})
