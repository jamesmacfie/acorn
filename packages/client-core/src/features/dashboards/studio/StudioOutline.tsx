import { createMemo, createSignal, For, Show } from 'solid-js'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DashboardRun, PlanProblem, PlanStageCount } from '@acorn/dashboards-core/plan.ts'
import {
  availableOperations, columnLabel, countsByPart, planOutline, problemsByPart, type OutlineDiff, type PartChange, type PlanInputs, type PlanPart, type PlanPartKey,
} from '@acorn/dashboards-core/outline.ts'
import { OPERATION_HELP } from '@acorn/dashboards-core/labels.ts'
import { Badge, Button, Row, SectionHeader } from '../../../kit/components/primitives'
import { Rows } from '../../../kit/components/layout/Rows'
import { Stack } from '../../../kit/components/layout/Stack'
import { Text } from '../../../kit/components/content/Text'
import Icon from '../../../kit/components/content/Icon'
import { ContextMenu, Menu } from '../../../kit/components/overlays/Menu'

// The studio's list column: the plan's parts in plain words, one list per section, each row with its
// row count and a mark when it has a problem (docs/dashboards/mapping-and-editor.md § The generated
// editor). The words come from `planOutline` in dashboards-core. While an AI proposal is under review,
// the outline is the proposed plan's, each row marked by what the proposal does to it.

const SECTIONS: readonly { id: PlanPart['section']; label: string }[] = [
  { id: 'data', label: 'Data' }, { id: 'columns', label: 'Columns' }, { id: 'steps', label: 'Steps' },
  { id: 'arrange', label: 'Arrange' }, { id: 'look', label: 'Look' }, { id: 'settings', label: 'Settings' },
]

export type OutlineAddition = 'source' | 'column' | PanelPlan['stages'][number]['op']

/** A row: a part of the plan, or a step the proposal removes, which keeps its old place struck through. */
type OutlineRow = Omit<PlanPart, 'key'> & { key: PlanPartKey | `removed:${PlanPartKey}`; change?: PartChange }
const MARKS: Record<Exclude<PartChange, 'same'>, { label: string; tone: 'ok' | 'accent' | 'danger' }> = {
  added: { label: 'Added', tone: 'ok' }, changed: { label: 'Changed', tone: 'accent' }, removed: { label: 'Removed', tone: 'danger' },
}

/** "+ Approval, − Draft, Status changed", for the columns row while a proposal is under review. */
const columnChangeWords = (diff: OutlineDiff, before: PanelPlan, after: PanelPlan): string => [
  ...diff.columnChanges.added.map(id => `+ ${columnLabel(after, id)}`),
  ...diff.columnChanges.removed.map(id => `− ${columnLabel(before, id)}`),
  ...diff.columnChanges.changed.map(id => `${columnLabel(after, id)} changed`),
].join(', ')

export default function StudioOutline(props: {
  plan: PanelPlan
  /** Each derived source's inputs, listed under it with what each read in the last run. */
  inputs: PlanInputs
  stageCounts: readonly PlanStageCount[]
  sourceCounts: DashboardRun['diagnostics']['sources']
  problems: readonly PlanProblem[]
  selected?: PlanPartKey
  onSelect: (key: PlanPartKey) => void
  onAdd: (addition: OutlineAddition) => void
  onMoveStage: (index: number, by: -1 | 1) => void
  onRemove: (key: PlanPartKey) => void
  onAskAi: (part: PlanPart) => void
  /** Set while a proposal is under review: `plan` is the proposed plan, and this compares it with
   *  `before`, the plan as it is. Adding, moving, and removing wait until review ends. */
  review?: { diff: OutlineDiff; before: PanelPlan }
}) {
  const parts = createMemo(() => planOutline(props.plan, [], props.inputs))
  const rows = createMemo((): OutlineRow[] => {
    const review = props.review
    if (!review) return parts()
    const marked: OutlineRow[] = parts().map(part => ({
      ...part, change: review.diff.parts[part.key] ?? 'same',
      ...(part.key === 'columns' ? { detail: columnChangeWords(review.diff, review.before, props.plan) || part.detail } : {}),
    }))
    // A removed step goes back where it was among the steps, which follow the data and columns rows.
    const firstStep = marked.findIndex(row => row.section === 'steps' || ['arrange', 'look', 'settings'].includes(row.section))
    for (const part of review.diff.removed) {
      const at = Math.min((firstStep < 0 ? marked.length : firstStep) + Number(part.key.slice('stage:'.length)), marked.length)
      marked.splice(at, 0, { ...part, key: `removed:${part.key}`, change: 'removed' })
    }
    return marked
  })
  const counts = createMemo(() => countsByPart(props.plan, props.stageCounts, props.sourceCounts))
  const problems = createMemo(() => problemsByPart(props.plan, props.problems, props.inputs))
  const count = (part: PlanPart): string | undefined => {
    if (part.key.startsWith('source:')) return counts().sourceTotal === undefined ? undefined : `${counts().sourceTotal} ${counts().sourceTotal === 1 ? 'row' : 'rows'}`
    if (part.key.startsWith('input:')) return counts().inputs[part.key] === undefined ? undefined : String(counts().inputs[part.key])
    const stage = counts().stages[part.key]
    return stage && `${stage.input} → ${stage.output}`
  }
  const partProblems = (key: OutlineRow['key']) => problems()[key as PlanPartKey] ?? []
  const pick = (key: string): void => { if (!key.startsWith('removed:')) props.onSelect(key as PlanPartKey) }

  // Where the row menu opens. The row that asked has focus by now, from the right-click's press or
  // the keyboard, so the menu opens under it either way.
  const [menu, setMenu] = createSignal<{ part: PlanPart; at: { x: number; y: number } } | null>(null)
  let menuRow: HTMLElement | undefined
  const openMenu = (key: string): void => {
    const part = parts().find(entry => entry.key === key)
    menuRow = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const rect = menuRow?.getBoundingClientRect()
    if (part) setMenu({ part, at: rect ? { x: rect.left + 16, y: rect.bottom } : { x: 0, y: 0 } })
  }
  const stageIndex = (key: PlanPartKey): number | undefined => key.startsWith('stage:') ? Number(key.slice('stage:'.length)) : undefined
  const removable = (key: PlanPartKey) => key.startsWith('source:') || key.startsWith('stage:')

  return (
    <Stack gap="none">
      <SectionHeader actions={
        <Menu ariaLabel="Add to the panel" trigger={state => (
          <Button size="sm" opens="menu" expanded={state.open()} disabled={!!props.review} onPress={state.toggle}><Icon name="plus" /> Add</Button>
        )}>
          {context => <>
            <Menu.Item context={context} disabled={props.plan.sources.length >= 8} onSelect={() => props.onAdd('source')}>Source</Menu.Item>
            <Menu.Item context={context} onSelect={() => props.onAdd('column')}>Column</Menu.Item>
            <Menu.Separator />
            <Menu.Label>Steps</Menu.Label>
            <For each={availableOperations(props.plan)}>{operation => (
              <Menu.Item context={context} disabled={!operation.available} title={operation.reason ?? OPERATION_HELP[operation.id]}
                onSelect={() => props.onAdd(operation.id)}>{operation.label}</Menu.Item>
            )}</For>
          </>}
        </Menu>
      }>Panel</SectionHeader>
      <For each={SECTIONS}>{section => {
        const sectionRows = () => rows().filter(part => part.section === section.id)
        return <Show when={sectionRows().length}>
          <SectionHeader level="group">{section.label}</SectionHeader>
          <Rows id={`dashboards.studio.outline.${section.id}`} ariaLabel={section.label} items={sectionRows()}
            selected={sectionRows().some(part => part.key === props.selected) ? props.selected! : null}
            onSelect={pick} onActivate={pick} {...(props.review ? {} : { onMenu: openMenu })}>
            {(part, itemProps, selected) => (
              <Row item={itemProps} selected={selected()} density="compact" variant="stacked" onPress={() => pick(part.key)}
                tip={partProblems(part.key).map(problem => problem.message).join('\n') || undefined}
                leading={<Icon name={part.icon} />}
                meta={<>
                  <Show when={part.change && part.change !== 'same' && MARKS[part.change]}>{mark => <Badge size="xs" tone={mark().tone}>{mark().label}</Badge>}</Show>
                  <Show when={partProblems(part.key).length}><Icon name="triangle-alert" title="Has a problem" /></Show>
                  <Show when={part.change !== 'removed' && count(part as PlanPart)}>{text => <Badge size="xs" tone={partProblems(part.key).length ? 'warn' : undefined}>{text()}</Badge>}</Show>
                </>}
              >
                <Stack gap="none">
                  <Show when={part.change === 'removed'} fallback={<Text>{part.title}</Text>}><s><Text>{part.title}</Text></s></Show>
                  <Show when={part.detail}>{detail => <Text emphasis="muted">{detail()}</Text>}</Show>
                </Stack>
              </Row>
            )}
          </Rows>
        </Show>
      }}</For>
      <ContextMenu at={() => menu()?.at ?? null} ariaLabel="Part actions" onClose={() => setMenu(null)} returnFocus={() => menuRow}>
        {context => <Show when={menu()?.part}>{part => <>
          <Show when={stageIndex(part().key) !== undefined}>
            <Menu.Item context={context} disabled={stageIndex(part().key) === 0} onSelect={() => props.onMoveStage(stageIndex(part().key)!, -1)}>Move up</Menu.Item>
            <Menu.Item context={context} disabled={stageIndex(part().key) === props.plan.stages.length - 1} onSelect={() => props.onMoveStage(stageIndex(part().key)!, 1)}>Move down</Menu.Item>
          </Show>
          <Show when={removable(part().key)}>
            <Menu.Item context={context} tone="danger" onSelect={() => props.onRemove(part().key)}>Remove</Menu.Item>
          </Show>
          <Menu.Item context={context} onSelect={() => props.onAskAi(part())}>Ask AI about this</Menu.Item>
        </>}</Show>}
      </ContextMenu>
    </Stack>
  )
}
