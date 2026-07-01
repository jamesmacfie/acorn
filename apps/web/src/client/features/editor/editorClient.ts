// Typed accessor for the preload's `window.acorn.editor` bridge — reads/writes files on the active
// task's worktree over IPC. Mirrors terminalClient.ts.

export type EditorEntry = { name: string; dir: boolean }

export type EditorApi = {
  // The worktree root for a task (created lazily), or null if the repo has no mapped checkout yet.
  root(taskId: string): Promise<string | null>
  // Directory entries under root+relPath (relPath '' = root). `.git`/`node_modules` filtered out.
  list(taskId: string, relPath: string): Promise<EditorEntry[]>
  read(taskId: string, relPath: string): Promise<string>
  write(taskId: string, relPath: string, content: string): Promise<{ ok: boolean; reason?: string }>
}

export const editorApi = (): EditorApi | null => window.acorn?.editor ?? null
