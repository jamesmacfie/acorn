import { Field, Input } from '@acorn/plugin-api/ui'
import type { WorkflowBudget } from '../../shared/workflowContracts'

const MS_PER_MINUTE = 60_000

/** The definition stores milliseconds; authoring uses minutes for both run and step budgets. */
export default function TimeBudgetField(props: {
  label: string
  hint: string
  budget: WorkflowBudget | undefined
  maxWallTimeMs?: number
  disabled?: boolean
  onChange: (budget: WorkflowBudget | undefined) => void
}) {
  const error = () => {
    const value = props.budget?.maxWallTimeMs
    if (value === undefined) return undefined
    if (!Number.isFinite(value) || value <= 0) return 'Enter a timeout greater than zero.'
    if (props.maxWallTimeMs !== undefined && value > props.maxWallTimeMs) return 'The step timeout must fit within the workflow timeout.'
    return undefined
  }
  return <Field label={props.label} hint={props.hint} error={error()} group>
    <Input type="number" width="narrow" label={props.label} step="any"
      disabled={props.disabled} invalid={!!error()}
      value={props.budget?.maxWallTimeMs === undefined ? '' : props.budget.maxWallTimeMs / MS_PER_MINUTE}
      onInput={(value) => {
        const budget = { ...props.budget }
        if (value.trim()) budget.maxWallTimeMs = Math.round(Number(value) * MS_PER_MINUTE)
        else delete budget.maxWallTimeMs
        props.onChange(Object.keys(budget).length ? budget : undefined)
      }} />
  </Field>
}
