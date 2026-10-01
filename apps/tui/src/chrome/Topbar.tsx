/** @jsxImportSource @acorn/tui/jsx */
import { Show } from 'solid-js'
import { nodeState } from '@acorn/client-core/infra/node/fleet.ts'
import { StatusDot } from '../kit/showing'
import { Line } from '../kit/cells'
import { terminalBadge } from '../kit/notify'
import { nodeTone } from './nodeState'
import { routedProjectId } from './routing'
import { highlightedTaskId, topOverlay } from './state'
import type { ShellModel } from './model'

// One line: which workspace and project, how many tasks are in it, the open branch, the node's state,
// and the open or highlighted task.
//
// Bespoke rather than a contribution. The desktop's topbar is an exclusive slot (docs/frontend.md), and
// a replaced topbar is a desktop surface. This one is kit nodes and one props object, which is the shape
// that slot contract asks for, so opening a terminal slot would move only its registration.
//
// Both names are labels here and nothing more: `w` opens the workspace picker and `p` the project
// one, as overlays, because a list under this line does not take the keys and a picker nobody can
// drive is worse than no picker (./Shell.tsx § WorkspacePicker).
//
// `Workspace > Project` rather than the workspace alone, because on this host the project is not
// visible anywhere else. The desktop carries it in the address bar and draws a picker beside the
// breadcrumb; a terminal has neither, so a reader whose browse list is empty has no way to tell a
// missing integration from the wrong project.
export function Topbar(props: { model: ShellModel; nodeId: string }) {
  const count = () => props.model.tasks().length
  const state = () => nodeState(props.nodeId)
  const project = () => props.model.workspace()?.projects.find((entry) => entry.id === routedProjectId())
  const shownTask = () => !topOverlay()
    ? props.model.tasks().find((task) => task.id === highlightedTaskId()) ?? props.model.task()
    : null
  const taskLabel = () => {
    const task = shownTask()
    if (!task) return null
    return `${task.id === props.model.task()?.id ? 'Task' : 'Task to open'}: ${task.title}`
  }

  return (
    // `flexShrink={0}`, like the footer's: a pane taller than the screen makes yoga take the deficit
    // out of every child that will give, and a one-line box shrunk to half a line lands on the line
    // above it — which drew the topbar and the pane strip into each other, one character each
    // (docs/tui.md).
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1}>
        <Line role="strong">{props.model.workspace()?.name ?? 'acorn'}</Line>
        <Show when={project()}>
          {(named) => (
            <>
              <Line role="muted">{'>'}</Line>
              <Line role="strong">{named().name}</Line>
            </>
          )}
        </Show>
        <Line role="muted">{`· ${count()} ${count() === 1 ? 'task' : 'tasks'}`}</Line>
        <box flexGrow={1} />
        <Show when={props.model.task()?.branch}>
          {(branch) => <Line role="muted">{branch()}</Line>}
        </Show>
        {/* What is waiting: the same number the desktop's bell puts on its pill and on the app icon,
            written here through the platform seam's `setBadge` (../kit/notify.ts). Its own glyph,
            where the desktop draws a bell: this is a host-owned attention marker, not a Lucide
            icon. Zero draws nothing, because a count that is always there says nothing
            when it moves. `n` opens what is behind it (./Inbox.tsx). */}
        <Show when={terminalBadge()}>
          {(count) => <Line tone="warn">{`◔ ${count()}`}</Line>}
        </Show>
        <StatusDot tone={nodeTone(state())} label={state()} />
        <Show when={taskLabel()}>
          {(label) => <box flexShrink={1} minWidth={0} overflow="hidden"><Line role="strong">{label()}</Line></box>}
        </Show>
      </box>
    </box>
  )
}
