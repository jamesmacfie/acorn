import { Show } from 'solid-js'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import DatabasePanel from './DatabasePanel'
import { EmptyState } from '@acorn/plugin-api/ui'

// One bundle, one manifest surface — the frame region of the `database` pane's `document-over-frame`
// layout. What it renders is decided by `bridge.context`, which is the frame contract: the HOST says
// what this rectangle was opened to look at.
//
// Everything this pane does is task-scoped. The database connection is resolved from the task's worktree
// (its `.env`, or the repo's connection script run inside it), so a frame with no task is not a degraded
// mode — it has nothing to connect to.
export function DatabaseFrameApp(props: { bridge: AcornBridge }) {
  const taskId = props.bridge.context.taskId
  return (
    <Show
      when={taskId}
      fallback={
        <div class="db-frame db-empty">
          <EmptyState align="start">This pane needs a task — its database comes from the task's worktree.</EmptyState>
        </div>
      }
    >
      {(id) => <DatabasePanel bridge={props.bridge} taskId={id()} />}
    </Show>
  )
}
