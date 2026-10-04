import { Stack } from '../../../kit/components/layout/Stack'
import { LabeledInput, LabeledSelect } from '../fields'
import { columnOptions, wholeNumber, type StageFormProps } from './stageFormParts'

/** "Find overlaps": one row per pair of rows whose start-to-end spans overlap. */
export default function OverlapForm(props: StageFormProps<'overlap'>) {
  const dates = () => props.columns.filter(column => column.type === 'datetime')
  return <Stack gap="row">
    <LabeledSelect label="Starts" value={props.stage.start} options={columnOptions(dates(), props.stage.start)} onChange={start => props.onChange({ ...props.stage, start })} />
    <LabeledSelect label="Ends" value={props.stage.end} options={columnOptions(dates(), props.stage.end)} onChange={end => props.onChange({ ...props.stage, end })} />
    <LabeledSelect label="Within each" value={props.stage.partition ?? ''} options={[{ value: '', label: 'Compare every row' }, ...columnOptions(props.columns, props.stage.partition)]}
      onChange={partition => { const { partition: _old, ...rest } = props.stage; props.onChange(partition ? { ...rest, partition } : rest) }} />
    <LabeledInput label="At most pairs" type="number" min={1} max={25000} value={String(props.stage.maxPairs)}
      onInput={raw => { const maxPairs = wholeNumber(raw); if (maxPairs !== undefined) props.onChange({ ...props.stage, maxPairs }, { coalesce: true }) }} />
  </Stack>
}
