import { Index, Show } from 'solid-js'
import { describePredicate } from '@acorn/dashboards-core/outline.ts'
import { Button, SegmentedControl } from '../../../kit/components/primitives'
import { Stack } from '../../../kit/components/layout/Stack'
import { ConditionEditor, editableComparison, newComparison, ReadOnlyPart, viewerPointer, type Comparison, type StageFormProps } from './stageFormParts'
import type { StudioChangeOptions } from './studioStore'

/** "Keep matching rows": one line per condition, matched all or any. One level of grouping is all the
 *  form edits. A deeper stored predicate shows in words. */
export default function FilterForm(props: StageFormProps<'filter'>) {
  const conditions = (): Comparison[] | undefined => {
    const where = props.stage.where
    const list = where.kind === 'comparison' ? [where] : where.predicates
    return list.length && list.every(editableComparison) ? list : undefined
  }
  const match = () => props.stage.where.kind === 'any' ? 'any' : 'all'
  const write = (list: Comparison[], kind: 'all' | 'any' = match(), options?: StudioChangeOptions) =>
    props.onChange({ op: 'filter', where: list.length === 1 ? list[0]! : { kind, predicates: list } }, options)
  const viewer = (columnId: string | undefined) => viewerPointer(props.plan, props.sources, columnId)
  return <Show when={conditions()} fallback={<ReadOnlyPart>{`Keep where ${describePredicate(props.plan, props.stage.where)}.`}</ReadOnlyPart>}>{list => <Stack gap="row">
    <Show when={list().length > 1}>
      <SegmentedControl ariaLabel="Match" size="sm" value={match()} onChange={kind => write(list(), kind)}
        options={[{ value: 'all', label: 'Match all of these' }, { value: 'any', label: 'Match any of these' }]} />
    </Show>
    <Index each={list()}>{(condition, index) => <ConditionEditor value={condition()} columns={props.columns} viewer={viewer}
      onChange={(value, options) => write(list().map((entry, at) => at === index ? value : entry), match(), options)}
      {...(list().length > 1 ? { onRemove: () => write(list().filter((_entry, at) => at !== index)) } : {})} />}</Index>
    <Button size="sm" disabled={!props.columns.length} onPress={() => write([...list(), newComparison(props.columns[0], viewer(props.columns[0]?.id))])}>Add condition</Button>
  </Stack>}</Show>
}
