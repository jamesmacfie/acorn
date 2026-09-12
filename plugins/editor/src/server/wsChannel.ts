// The editor pane's own-editor handoff: `$EDITOR` on one file, in a PTY that dies with the panel.
//
// Modelled on docker's exec channel rather than on a terminal-plugin session, and deliberately: a
// `create({ command })` session would work, but it buys a persistent session row, a tmux binding and
// a drawer tab per edited file, none of which "editing this file right now" wants. What is left is a
// client-minted id, a socket, and a spawn that is torn down on kill or disconnect.
import { spawn as ptySpawn, type IPty } from 'node-pty'
import type { CompiledPluginBroadcast } from '@acorn/plugin-api/node'
import type { EditorClientFrame } from '../shared/editorPty'
import type { EditorCoreServices } from './editor'

const MAX_PTYS_PER_CONN = 8
const clampDim = (value: number, fallback: number, max: number) =>
  Math.max(2, Math.min(max, Math.trunc(value) || fallback))

// The one line of shell. `$EDITOR` may be a name, a name with flags, or a shell function, so the
// expansion is unquoted on purpose: quoting it would turn `code -w` into a program nobody has. The
// file arrives as `$1`, which is the only reason no quoting is needed around a path a peer supplied.
const EDITOR_SCRIPT = 'exec ${EDITOR:-${VISUAL:-vi}} "$1"'

export function registerEditorWsChannel(events: CompiledPluginBroadcast, core: EditorCoreServices): void {
  // `null` is a slot claimed by an open that has not finished resolving the worktree yet, so the
  // per-connection ceiling and the duplicate-id check both count it.
  const ptys = new Map<object, Map<string, IPty | null>>()

  events.channel('editor', {
    onFrame(rawFrame, send, conn) {
      // The one cast, at the front door: core hands over an open envelope and this plugin owns what is
      // inside it. Every field read below is still guarded, because the sender is a peer over JSON.
      const frame = rawFrame as EditorClientFrame
      switch (frame.channel) {
        case 'editor:pty:open': {
          const { ptyId, taskId, path, cols, rows } = frame
          if (typeof ptyId !== 'string' || typeof taskId !== 'string' || typeof path !== 'string') return
          const mine = ptys.get(conn) ?? new Map<string, IPty | null>()
          ptys.set(conn, mine)
          if (mine.has(ptyId) || mine.size >= MAX_PTYS_PER_CONN) return
          mine.set(ptyId, null)
          void (async () => {
            const root = await core.tasks.root(taskId)
            const abs = root && core.fs.resolveInRoot(root, path)
            const bail = () => {
              mine.delete(ptyId)
              send({ channel: 'editor:pty:exit', ptyId, code: 1 })
            }
            if (!abs) return bail()
            const env = process.env as Record<string, string>
            let pty: IPty
            try {
              // A login shell, like the terminal plugin's command override, because `$EDITOR` is set in
              // a shell profile and PATH is where nvm and friends put things.
              pty = ptySpawn(env.SHELL || '/bin/sh', ['-lc', EDITOR_SCRIPT, 'acorn-editor', abs], {
                name: 'xterm-256color',
                cols: clampDim(cols, 80, 500),
                rows: clampDim(rows, 24, 300),
                cwd: root,
                env,
              })
            } catch {
              return bail()
            }
            // A kill can land while the open is still resolving: the slot is gone, so is the pane.
            if (!mine.has(ptyId)) return pty.kill()
            mine.set(ptyId, pty)
            pty.onData((data) => send({ channel: 'editor:pty:out', ptyId, data }))
            pty.onExit(({ exitCode }) => {
              mine.delete(ptyId)
              send({ channel: 'editor:pty:exit', ptyId, code: exitCode })
            })
          })()
          return
        }
        case 'editor:pty:in':
          ptys.get(conn)?.get(frame.ptyId)?.write(frame.data)
          return
        case 'editor:pty:resize': {
          const pty = ptys.get(conn)?.get(frame.ptyId)
          if (pty) pty.resize(clampDim(frame.cols, 80, 500), clampDim(frame.rows, 24, 300))
          return
        }
        case 'editor:pty:kill': {
          const mine = ptys.get(conn)
          mine?.get(frame.ptyId)?.kill()
          mine?.delete(frame.ptyId) // also releases a slot still claimed by an unresolved open
          return
        }
        default:
          return
      }
    },
    onDisconnect: (conn) => {
      for (const pty of ptys.get(conn)?.values() ?? []) pty?.kill()
      ptys.delete(conn)
    },
  })
}
