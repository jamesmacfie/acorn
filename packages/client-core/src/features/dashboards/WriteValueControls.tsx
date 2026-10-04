import { For, Show } from 'solid-js'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { Select } from '../../kit/components/primitives'

export default function WriteValueControls(props: {
  column: PanelPlan['columns'][number]
  choice: NonNullable<PanelPlan['columns'][number]['choices']>[number]
  sources: PanelPlan['sources']
  descriptions: Record<string, DataSourceDescription | undefined>
  onChange(sourceId: string, value: DataValue | undefined, present: boolean): void
}) {
  return <For each={props.sources}>{source => {
    const binding = () => props.column.bind[source.id]
    const writable = () => 'field' in (binding() ?? {})
      ? props.descriptions[source.id]?.writable?.find(item => item.field === (binding() as { field: string }).field) : undefined
    const current = () => props.choice.writeValues && Object.hasOwn(props.choice.writeValues, source.id)
      ? `value:${JSON.stringify(props.choice.writeValues[source.id])}` : ''
    return <Show when={writable()}>{field => <Select label={`When dropped here, set ${source.label}`} size="sm"
      value={current()} options={[{ value: '', label: 'Do not write' }, ...field().values.map(value => ({
        value: `value:${JSON.stringify(value)}`, label: value === null ? 'Null' : String(value),
      }))]}
      onChange={encoded => props.onChange(source.id, encoded ? JSON.parse(encoded.slice(6)) as DataValue : undefined, !!encoded)} />}</Show>
  }}</For>
}
