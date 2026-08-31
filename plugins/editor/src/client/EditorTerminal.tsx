// The file, open in the reader's own editor. A throwaway PTY over the editor:pty channel, in the kit's
// PTY rectangle — the same shape docker's exec panel has, and throwaway for the same reason: it lives
// as long as the file is open in terminal mode, with no session row, no tmux and no drawer tab.
//
// The emulator is the host's. This file says what the channel is and nothing about how it is drawn, so
// the same source runs an editor in a browser and in a terminal, where the box is cells and the
// reader's `$EDITOR` is running inside the terminal they are already in
// (docs/editor.md § Editing in your own editor, docs/terminal.md § Client).
import { attachPty, Rectangle, type PtyIo } from '@acorn/plugin-api/ui'
import { wsEditorPtyInput, wsEditorPtyOpen, wsEditorPtyResize } from './wsChannel'

export default function EditorTerminal(props: { taskId: string; path: string; onExit: (code: number) => void }) {
  const ptyId = crypto.randomUUID()
  const io: PtyIo = {
    open: ({ cols, rows }, onEvent) => wsEditorPtyOpen(ptyId, props.taskId, props.path, cols, rows, (event) => {
      if (event.kind === 'out') onEvent({ kind: 'out', data: event.data })
      else props.onExit(event.code)
    }),
    input: (data) => wsEditorPtyInput(ptyId, data),
    resize: ({ cols, rows }) => wsEditorPtyResize(ptyId, cols, rows),
  }

  // The kit owns the box and the way in and out of it with the keyboard.
  return <Rectangle kind="pty" label={`Editing ${props.path}`} mount={(handle) => attachPty(handle, io)} />
}
