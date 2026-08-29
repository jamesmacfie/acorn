import { Show } from 'solid-js'
import { EmptyState } from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import DatabasePanel from './DatabasePanel'

// One bundle, one manifest surface: the lower region of the `database` pane's `document-over-frame`
// layout (docs/third-party/monaco.md § Composed panes: decided). The props the host mounted this slot
// with decide what it renders.
//
// Everything this pane does is task-scoped. The connection is resolved from the task's worktree, from
// its `.env` or the repo's connection script run inside it, so a slot with no task has nothing to
// connect to.
export function DatabasePaneApp(props: { taskId?: string; bridge: AcornBridge }) {
  return (
    <Show
      when={props.taskId}
      fallback={<EmptyState align="start">This pane needs a task — its database comes from the task's worktree.</EmptyState>}
    >
      {(id) => <DatabasePanel bridge={props.bridge} taskId={id()} />}
    </Show>
  )
}
