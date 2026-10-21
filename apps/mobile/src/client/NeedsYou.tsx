import { For, Show } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { openTarget } from '@acorn/client-core/features/notifications'
import { layoutForTask } from '@acorn/client-core/features/tasks/tasks.ts'
import type { Task } from '@acorn/client-core/infra/queries.ts'
import { Text } from '@acorn/client-core/kit/components/content'
import { Row, SectionHeader } from '@acorn/client-core/kit/components/primitives.tsx'
import type { WaitingRow } from './waiting'

/** What is waiting on a person: the desktop bell's "Needs you" section as a list, of the rows the
 *  screen picks. Nothing draws while nothing waits. */
export function NeedsYou(props: { rows: WaitingRow[]; tasks: Task[] | undefined }) {
  const navigate = useNavigate()
  const open = ({ item }: WaitingRow) => {
    // The source's own handler selects the thing and shows its pane in the task's layout. The route
    // names the pane on a phone, so it takes the one the handler just showed.
    openTarget(item.taskId ?? '', item.target)
    if (!item.taskId) return
    const pane = layoutForTask(item.taskId)?.panes.at(-1)
    navigate(pane ? `/t/${item.taskId}/${pane}` : `/t/${item.taskId}`)
  }
  return (
    <Show when={props.rows.length}>
      <section>
        <SectionHeader level="group" count={props.rows.length}>
          Needs you
        </SectionHeader>
        <For each={props.rows}>
          {(row) => (
            <Row variant="stacked" onPress={() => open(row)}>
              <Text emphasis="strong">{row.item.title}</Text>
              <Text emphasis="muted">
                {[props.tasks?.find((task) => task.id === row.item.taskId)?.title, row.item.detail]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Row>
          )}
        </For>
      </section>
    </Show>
  )
}
