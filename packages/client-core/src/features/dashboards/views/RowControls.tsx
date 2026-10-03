import { For, Show } from 'solid-js'
import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { PlanRecordItem } from '@acorn/dashboards-core/plan.ts'
import { Button } from '../../../kit/components/primitives'
import { RowActions } from '../../../kit/components/layout/RowActions'
import { Menu } from '../../../kit/components/overlays/Menu'

type ButtonPlan = NonNullable<PanelPlan['actions']>['buttons'][number]

export default function RowControls(props: {
  panelId?: string
  row: DashboardDisplayRow
  buttons?: ButtonPlan[]
  onButton?: (row: DashboardDisplayRow, button: ButtonPlan) => void
  onOpenRecord?: (row: DashboardDisplayRow, item: PlanRecordItem) => void
}) {
  const task: ButtonPlan = { kind: 'createTask', label: 'Start task' }
  return <span class="dash-row-controls" data-dash-panel={props.panelId ?? ''} data-dash-row={props.row.id}>
    <For each={props.buttons ?? []}>{button => <Button size="xs" variant="ghost" onPress={() => props.onButton?.(props.row, button)}>{button.label}</Button>}</For>
    <RowActions ariaLabel={`Actions for ${props.row.id}`}>
      {menu => <>
        <Show when={(props.row.recordItems?.length ?? 0) > 1}><For each={props.row.recordItems}>{item => <Menu.Item context={menu} onSelect={() => props.onOpenRecord?.(props.row, item)}>Open {item.ref.pluginId} {item.ref.recordId}</Menu.Item>}</For></Show>
        <For each={props.buttons ?? []}>{button => <Menu.Item context={menu} onSelect={() => props.onButton?.(props.row, button)}>{button.label}</Menu.Item>}</For>
        <Show when={!(props.buttons ?? []).some(button => button.kind === 'createTask')}><Menu.Item context={menu} onSelect={() => props.onButton?.(props.row, task)}>Start task</Menu.Item></Show>
      </>}
    </RowActions>
  </span>
}

export function openRowMenu(panelId: string | undefined, rowId: string): void {
  const controls = [...document.querySelectorAll<HTMLElement>('[data-dash-row]')]
    .find(element => element.dataset.dashPanel === (panelId ?? '') && element.dataset.dashRow === rowId)
  controls?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.click()
}
