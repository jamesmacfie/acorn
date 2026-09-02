/** @jsxImportSource @opentui/solid */
import { Show } from 'solid-js'
import { nodeState } from '@acorn/client-core/infra/node/fleet.ts'
import { StatusDot } from '../kit/showing'
import { Line } from '../kit/cells'
import { terminalBadge } from '../kit/notify'
import { nodeTone } from './nodeState'
import { routedProjectId } from './routing'
import type { ShellModel } from './model'

// One line: which workspace and project, how many tasks are in it, which branch is open, and how the
// node is.
//
// Bespoke rather than a contribution, and that is what it will stop being: the topbar is one of the
// four surfaces `docs/future/client-plugins/04-replaceable-surfaces.md` turns into a slot, and when it
// does this becomes core's provider. It is kit nodes and one props object already, which is the shape
// that contract asks for, so the day the slot opens nothing here moves except its registration.
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
            written here through the platform seam's `setBadge` (../kit/notify.ts). The same glyph the
            bell uses, so the two hosts read as one product. Zero draws nothing — a count that is
            always there says nothing when it moves. `n` opens what is behind it (./Inbox.tsx). */}
        <Show when={terminalBadge()}>
          {(count) => <Line tone="warn">{`◔ ${count()}`}</Line>}
        </Show>
        <StatusDot tone={nodeTone(state())} label={state()} />
      </box>
    </box>
  )
}
