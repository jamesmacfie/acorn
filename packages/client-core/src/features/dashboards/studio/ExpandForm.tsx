import { Stack } from '../../../kit/components/layout/Stack'
import { LabeledInput, LabeledSelect } from '../fields'
import { columnOptions, wholeNumber, type StageFormProps } from './stageFormParts'

/** "Expand a list": one row per item in a list column. The new item column's id was made when the
 *  step was added, so the form never asks for it. */
export default function ExpandForm(props: StageFormProps<'expand'>) {
  return <Stack gap="row">
    <LabeledSelect label="List column" value={props.stage.column} options={columnOptions(props.columns.filter(column => column.list), props.stage.column)}
      onChange={column => props.onChange({ ...props.stage, column })} />
    <LabeledInput label="At most per row" type="number" min={1} max={100} value={String(props.stage.perRow)}
      onInput={raw => { const perRow = wholeNumber(raw); if (perRow !== undefined) props.onChange({ ...props.stage, perRow }, { coalesce: true }) }} />
  </Stack>
}
