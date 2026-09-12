// The editor plugin's half of the WebSocket. Core owns the envelope and routes on the `editor`
// prefix (@acorn/client-core/infra/node/wsChannels.ts); the listener map below is this plugin's.
//
// One listener per PTY, and no reconnect reattach: the PTY dies with the connection, the pane shows
// the exit and re-reads the file, which is the same thing it does when the editor quits normally.
import { registerWsChannel, wsConnect, wsSend } from '@acorn/plugin-api/client'
import type { EditorServerFrame } from '../shared/editorPty'

export type EditorPtyEvent = { kind: 'out'; data: string } | { kind: 'exit'; code: number }
const ptySubs = new Map<string, (event: EditorPtyEvent) => void>()

// Open `$EDITOR` on one file; returns a dispose that kills it. Input and resize ride the same socket.
export function wsEditorPtyOpen(
  ptyId: string,
  taskId: string,
  path: string,
  cols: number,
  rows: number,
  cb: (event: EditorPtyEvent) => void,
): () => void {
  ptySubs.set(ptyId, cb)
  wsConnect()
  wsSend({ channel: 'editor:pty:open', ptyId, taskId, path, cols, rows })
  return () => {
    ptySubs.delete(ptyId)
    wsSend({ channel: 'editor:pty:kill', ptyId })
  }
}

export function wsEditorPtyInput(ptyId: string, data: string): void {
  wsSend({ channel: 'editor:pty:in', ptyId, data })
}

export function wsEditorPtyResize(ptyId: string, cols: number, rows: number): void {
  wsSend({ channel: 'editor:pty:resize', ptyId, cols, rows })
}

registerWsChannel('editor', (rawFrame) => {
  // The one cast, at the front door, against this plugin's own union (../shared/editorPty.ts).
  const frame = rawFrame as EditorServerFrame
  switch (frame.channel) {
    case 'editor:pty:out':
      return ptySubs.get(frame.ptyId)?.({ kind: 'out', data: frame.data })
    case 'editor:pty:exit':
      return ptySubs.get(frame.ptyId)?.({ kind: 'exit', code: frame.code })
  }
})

// Test seam: the map is a module singleton, and core's _resetWsClient does not know about it.
export const _resetEditorWsChannel = (): void => ptySubs.clear()
