import { afterEach, describe, expect, it } from 'vitest'
import { formPlan, mountStageForm } from '../../../testkit/stageForms'
import OverlapForm from './OverlapForm'

let form: ReturnType<typeof mountStageForm<'overlap'>> | undefined
afterEach(() => { form?.dispose(); form = undefined })

describe('OverlapForm', () => {
  it('writes starts, ends, a partition, and a pair limit', () => {
    form = mountStageForm(OverlapForm, formPlan({ op: 'overlap', start: 'created', end: 'merged', maxPairs: 5000 }))
    expect(form.options('Starts')).toEqual(['Created', 'Merged'])
    form.choose('Within each', 'Author')
    form.type('At most pairs', '200')
    expect(form.stage()).toEqual({ op: 'overlap', start: 'created', end: 'merged', partition: 'author', maxPairs: 200 })
    form.choose('Within each', 'Compare every row')
    expect(form.stage()).not.toHaveProperty('partition')
  })
})
