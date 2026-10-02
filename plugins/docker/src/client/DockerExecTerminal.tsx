// A minimal in-panel exec terminal over the docker:exec WS channel. Independent of the terminal
// plugin, which is a frozen boundary, and throwaway: it dies with the panel or the connection, with no
// ring, no tmux, no persistence.
//
// The emulator is the host's. This file says what the channel is and nothing about how it is drawn, so
// the same source execs into a container from a browser and from a terminal, where the box is cells
// (docs/terminal.md § Client).
import { useQueryClient } from '@tanstack/solid-query'
import { queryOwner } from '@acorn/plugin-api/client'
import { attachPty, Rectangle, type PtyIo } from '@acorn/plugin-api/ui'
import { captureDockerScope } from './dockerScope'
import { wsDockerExecInput, wsDockerExecOpen, wsDockerExecResize } from './wsChannel'

export default function DockerExecTerminal(props: { containerRef: string; label: string }) {
  const owner = captureDockerScope(queryOwner(useQueryClient()))
  const ref = props.containerRef
  const execId = crypto.randomUUID()
  const io: PtyIo = {
    open: ({ cols, rows }, onEvent) => wsDockerExecOpen(execId, ref, cols, rows, (event) => {
      if (event.kind === 'out') onEvent({ kind: 'out', data: event.data })
      else onEvent({ kind: 'exit', code: null })
    }, owner),
    input: (data) => wsDockerExecInput(execId, data, owner),
    resize: ({ cols, rows }) => wsDockerExecResize(execId, cols, rows, owner),
    farewell: '[session ended]',
  }

  // The kit owns the box and the way in and out of it with the keyboard.
  return <Rectangle kind="pty" label={props.label} mount={(handle) => attachPty(handle, io)} />
}
