// The editor pane's throwaway-PTY frames. Core owns the envelope and routes on the `editor` prefix
// (@acorn/protocol/ws.ts); everything inside belongs to this plugin.
//
// One PTY per file being edited, addressed by a client-minted `ptyId`. It carries no session row, no
// tmux binding and no drawer tab: it lives exactly as long as the file is open in terminal mode, the
// same shape docker's exec terminal uses.

// Client to node. `path` is worktree-relative and confined at the handler before it reaches a shell.
export type EditorClientFrame =
  | { channel: 'editor:pty:open'; ptyId: string; taskId: string; path: string; cols: number; rows: number }
  | { channel: 'editor:pty:in'; ptyId: string; data: string }
  | { channel: 'editor:pty:resize'; ptyId: string; cols: number; rows: number }
  | { channel: 'editor:pty:kill'; ptyId: string }

// Node to client. `code` is the editor's exit status: non-zero means it gave up, and the pane says so
// rather than pretending the file was saved.
export type EditorServerFrame =
  | { channel: 'editor:pty:out'; ptyId: string; data: string }
  | { channel: 'editor:pty:exit'; ptyId: string; code: number }
