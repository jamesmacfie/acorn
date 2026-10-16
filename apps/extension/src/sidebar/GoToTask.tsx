import { For, Show, createEffect, createMemo, createSignal, on, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { BridgePageTask, BridgeProject, BridgeWorkspace } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import PickerRow from '@acorn/client-core/kit/components/inputs/PickerRow.tsx'
import { Button, Kbd } from '@acorn/client-core/kit/components/primitives.tsx'
import { createAnchoredPopover } from '@acorn/client-core/kit/lib/anchor'
import { restoreFocusOnCleanup } from '@acorn/client-core/kit/keys/trap'
import { nodeState } from './state'

type Row = { id: string; label: string; description?: string; leading: string | null; pick(): void }
type Group = { label: string | null; rows: Row[] }

// Go to task: Home, then the page's task, then every open task under its workspace and project, in
// the order projects.list gives. Typing filters tasks by title and branch. It opens under the top bar
// from its button, the task's title, or the keyboard, so it has no trigger of its own and draws the
// kit's picker parts on an anchored popover rather than the trigger-owning Picker.
export function GoToTask(props: {
  open: boolean
  close(): void
  // The top bar, which the palette hangs under.
  anchor: HTMLElement | undefined
  tasks: readonly BridgePageTask[]
  // The Node's visible projects and its workspaces, null until they load.
  projects: readonly BridgeProject[] | null
  workspaces: readonly BridgeWorkspace[] | null
  pageTaskId: string | null
  // The task the top bar names, which the palette marks.
  shownTaskId: string | null
  nodeLabel: string
  status: NodeStatus | null
  goHome(): void
  openTask(taskId: string): void
  switchNode(): void
}) {
  const popover = createAnchoredPopover({
    anchor: () => props.anchor,
    open: () => props.open,
    onOpenChange: (open) => !open && props.close(),
  })
  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={(element) => popover.setSurface(element)}
          class="repo-picker-popover repo-picker-popover-fixed go-to-task"
          role="dialog"
          aria-label="Go to task"
          style={popover.surfaceStyle()}
        >
          <Palette {...props} />
        </div>
      </Portal>
    </Show>
  )
}

// The palette's contents, mounted on each open so the filter and the cursor start fresh.
function Palette(props: Parameters<typeof GoToTask>[0]) {
  const [filter, setFilter] = createSignal('')
  const [cursor, setCursor] = createSignal(0)
  let input: HTMLInputElement | undefined
  restoreFocusOnCleanup()
  onMount(() => input?.focus())

  const close = (then: () => void) => () => {
    props.close()
    then()
  }
  const taskRow = (task: BridgePageTask): Row => ({
    id: task.id,
    label: task.title,
    description: task.branch ?? 'Project checkout',
    leading: task.id === props.shownTaskId ? 'check' : null,
    pick: close(() => props.openTask(task.id)),
  })
  const groups = createMemo((): Group[] => {
    const query = filter().trim().toLowerCase()
    const matches = (task: BridgePageTask) => `${task.title} ${task.branch ?? ''}`.toLowerCase().includes(query)
    const pageTask = props.tasks.find((task) => task.id === props.pageTaskId)
    const workspaceName = (id: string) => props.workspaces?.find((workspace) => workspace.id === id)?.name
    const all: Group[] = [
      {
        label: null,
        rows: 'home'.includes(query)
          ? [{ id: 'home', label: 'Home', leading: 'house', pick: close(props.goHome) }]
          : [],
      },
      { label: 'This page', rows: pageTask && matches(pageTask) ? [taskRow(pageTask)] : [] },
      ...(props.projects ?? []).map((project) => ({
        label: [workspaceName(project.workspaceId), project.name].filter(Boolean).join(' › '),
        rows: props.tasks
          .filter((task) => task.projectId === project.id && task.id !== props.pageTaskId && matches(task))
          .map(taskRow),
      })),
    ]
    return all.filter((group) => group.rows.length)
  })
  const rows = createMemo(() => groups().flatMap((group) => group.rows))
  createEffect(on(filter, () => setCursor(0)))

  const onKeyDown = (event: KeyboardEvent) => {
    const count = rows().length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (count) setCursor((at) => (at + (event.key === 'ArrowDown' ? 1 : count - 1)) % count)
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      rows()[cursor()]?.pick()
    }
  }

  return (
    <>
      <div class="repo-picker-tools">
        <Icon name="search" tone="muted" />
        <input
          ref={(element) => (input = element)}
          class="repo-picker-filter"
          placeholder="Go to task"
          aria-label="Go to task"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <Kbd size="xs">esc</Kbd>
      </div>
      <Show when={rows().length} fallback={<p class="repo-picker-empty">No open task matches.</p>}>
        <ul class="repo-picker-list" role="listbox" aria-label="Tasks">
          <For each={groups()}>
            {(group) => (
              <>
                <Show when={group.label}>
                  <li class="repo-picker-group" role="presentation">
                    {group.label}
                  </li>
                </Show>
                <For each={group.rows}>
                  {(row) => (
                    <PickerRow
                      role="option"
                      label={row.label}
                      description={row.description}
                      active={rows()[cursor()] === row}
                      leading={<span class="go-to-task-lead">{row.leading && <Icon name={row.leading} />}</span>}
                      onHover={() => setCursor(rows().indexOf(row))}
                      onSelect={row.pick}
                    />
                  )}
                </For>
              </>
            )}
          </For>
        </ul>
      </Show>
      <div class="repo-picker-footer row">
        <span class="dot" data-tone={nodeState(props.status).tone} aria-hidden="true" />
        <span class="grow">{props.nodeLabel}</span>
        <Button label="Switch Node" variant="bare" onPress={close(props.switchNode)} />
      </div>
    </>
  )
}
