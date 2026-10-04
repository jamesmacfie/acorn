import { createMemo, createSignal, For, Show } from 'solid-js'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { PlanProblem, PlanStageCount } from '@acorn/dashboards-core/plan.ts'
import { availableOperations, countsByPart, planOutline, problemsByPart, type PlanPart, type PlanPartKey } from '@acorn/dashboards-core/outline.ts'
import { Badge, Button, Row, SectionHeader } from '../../../kit/components/primitives'
import { Rows } from '../../../kit/components/layout/Rows'
import { Stack } from '../../../kit/components/layout/Stack'
import { Text } from '../../../kit/components/content/Text'
import Icon from '../../../kit/components/content/Icon'
import { ContextMenu, Menu } from '../../../kit/components/overlays/Menu'

// The studio's list column: the plan's parts in plain words, one list per section, each row with its
// row count and a mark when it has a problem (docs/dashboards/mapping-and-editor.md § The generated
// editor). The words come from `planOutline` in dashboards-core.

const SECTIONS: readonly { id: PlanPart['section']; label: string }[] = [
  { id: 'data', label: 'Data' }, { id: 'columns', label: 'Columns' }, { id: 'steps', label: 'Steps' },
  { id: 'arrange', label: 'Arrange' }, { id: 'look', label: 'Look' }, { id: 'settings', label: 'Settings' },
]

export type OutlineAddition = 'source' | 'column' | PanelPlan['stages'][number]['op']

export default function StudioOutline(props: {
  plan: PanelPlan
  stageCounts: readonly PlanStageCount[]
  problems: readonly PlanProblem[]
  selected?: PlanPartKey
  onSelect: (key: PlanPartKey) => void
  onAdd: (addition: OutlineAddition) => void
  onMoveStage: (index: number, by: -1 | 1) => void
  onRemove: (key: PlanPartKey) => void
  onAskAi: (part: PlanPart) => void
}) {
  const parts = createMemo(() => planOutline(props.plan))
  const counts = createMemo(() => countsByPart(props.plan, props.stageCounts))
  const problems = createMemo(() => problemsByPart(props.plan, props.problems))
  const count = (part: PlanPart): string | undefined => {
    if (part.key.startsWith('source:')) return counts().sourceTotal === undefined ? undefined : String(counts().sourceTotal)
    const stage = counts().stages[part.key]
    return stage && `${stage.input} → ${stage.output}`
  }
  const partProblems = (key: PlanPartKey) => problems()[key] ?? []

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
          <Button size="sm" opens="menu" expanded={state.open()} onPress={state.toggle}><Icon name="plus" /> Add</Button>
        )}>
          {context => <>
            <Menu.Item context={context} disabled={props.plan.sources.length >= 8} onSelect={() => props.onAdd('source')}>Source</Menu.Item>
            <Menu.Item context={context} onSelect={() => props.onAdd('column')}>Column</Menu.Item>
            <Menu.Separator />
            <Menu.Label>Steps</Menu.Label>
            <For each={availableOperations(props.plan)}>{operation => (
              <Menu.Item context={context} disabled={!operation.available} title={operation.reason ?? operation.description}
                onSelect={() => props.onAdd(operation.id)}>{operation.label}</Menu.Item>
            )}</For>
          </>}
        </Menu>
      }>Panel</SectionHeader>
      <For each={SECTIONS}>{section => {
        const rows = () => parts().filter(part => part.section === section.id)
        return <Show when={rows().length}>
          <SectionHeader level="group">{section.label}</SectionHeader>
          <Rows id={`dashboards.studio.outline.${section.id}`} ariaLabel={section.label} items={rows()}
            selected={rows().some(part => part.key === props.selected) ? props.selected! : null}
            onSelect={key => props.onSelect(key as PlanPartKey)} onActivate={key => props.onSelect(key as PlanPartKey)} onMenu={openMenu}>
            {(part, itemProps, selected) => (
              <Row item={itemProps} selected={selected()} density="compact" variant="stacked" onPress={() => props.onSelect(part.key)}
                tip={partProblems(part.key).map(problem => problem.message).join('\n') || undefined}
                leading={<Icon name={part.icon} />}
                meta={<>
                  <Show when={partProblems(part.key).length}><Icon name="triangle-alert" title="Has a problem" /></Show>
                  <Show when={count(part)}>{text => <Badge size="xs" tone={partProblems(part.key).length ? 'warn' : undefined}>{text()}</Badge>}</Show>
                </>}
              >
                <Stack gap="none">
                  <Text>{part.title}</Text>
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
