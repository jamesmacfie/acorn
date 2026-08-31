/** @jsxImportSource @opentui/solid */
import { Show } from 'solid-js'
import { nodeState } from '@acorn/client-core/infra/node/fleet.ts'
import { StatusDot } from '../kit/showing'
import { Line } from '../kit/cells'
import { nodeTone } from './nodeState'
import type { ShellModel } from './model'

// One line: which workspace, how many tasks in it, which branch is open, and how the node is.
//
// Bespoke rather than a contribution, and that is what it will stop being: the topbar is one of the
// four surfaces `docs/future/client-plugins/04-replaceable-surfaces.md` turns into a slot, and when it
// does this becomes core's provider. It is kit nodes and one props object already, which is the shape
// that contract asks for, so the day the slot opens nothing here moves except its registration.
//
// The workspace name is a label here and nothing more: `w` opens the picker as an overlay, because a
// list under this line does not take the keys and a picker nobody can drive is worse than no picker
// (./Shell.tsx § WorkspacePicker).
export function Topbar(props: { model: ShellModel; nodeId: string }) {
  const count = () => props.model.tasks().length
  const state = () => nodeState(props.nodeId)

  return (
    // `flexShrink={0}`, like the footer's: a pane taller than the screen makes yoga take the deficit
    // out of every child that will give, and a one-line box shrunk to half a line lands on the line
    // above it — which drew the topbar and the pane strip into each other, one character each
    // (docs/tui.md).
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1}>
        <Line role="strong">{props.model.workspace()?.name ?? 'acorn'}</Line>
        <Line role="muted">{`· ${count()} ${count() === 1 ? 'task' : 'tasks'}`}</Line>
        <box flexGrow={1} />
        <Show when={props.model.task()?.branch}>
          {(branch) => <Line role="muted">{branch()}</Line>}
        </Show>
        <StatusDot tone={nodeTone(state())} label={state()} />
      </box>
    </box>
  )
}
