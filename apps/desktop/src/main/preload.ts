import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CreateOpts, ServerMsg } from '../shared/terminal'

// Narrow capability surface (docs/electron.md §4g): expose only a desktop marker and the validated
// terminal channels (vNext §5) — never raw ipcRenderer.
contextBridge.exposeInMainWorld('acorn', {
  desktop: true,
  platform: process.platform,
  // Cmd/Ctrl+W → close the focused pane (terminal tab / editor file), never the window. Main
  // suppresses the native accelerator and pings here; the pane that owns focus handles it.
  onClosePane: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('acorn:close-pane', listener)
    return () => ipcRenderer.removeListener('acorn:close-pane', listener)
  },
  terminal: {
    list: () => ipcRenderer.invoke('term:list'),
    profiles: () => ipcRenderer.invoke('term:profiles'),
    create: (opts: CreateOpts) => ipcRenderer.invoke('term:create', opts),
    kill: (id: string) => ipcRenderer.invoke('term:kill', id),
    interrupt: (id: string) => ipcRenderer.invoke('term:interrupt', id),
    remove: (id: string) => ipcRenderer.invoke('term:remove', id),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('term:resize', { id, cols, rows }),
    repoPath: {
      get: (owner: string, repo: string) => ipcRenderer.invoke('term:repoPath:get', { owner, repo }),
      set: (owner: string, repo: string, path: string) => ipcRenderer.invoke('term:repoPath:set', { owner, repo, path }),
      // Native folder picker (onboarding / repo mapping). Returns the chosen absolute path or null.
      pick: () => ipcRenderer.invoke('term:repoPath:pick'),
      // Per-repo run targets as a JSON RunTarget[] string (docs/next 13 §A DB fallback).
      runTargets: (owner: string, repo: string, runTargets: string) =>
        ipcRenderer.invoke('term:repoPath:runTargets', { owner, repo, runTargets }),
    },
    // Run targets (docs/next 13 §A): named commands per repo, run in the task's worktree.
    run: {
      targets: (taskId: string) => ipcRenderer.invoke('run:targets', taskId),
      start: (taskId: string, targetId: string) => ipcRenderer.invoke('run:start', { taskId, targetId }),
      stop: (taskId: string, targetId: string) => ipcRenderer.invoke('run:stop', { taskId, targetId }),
      status: (taskId: string, targetId: string) => ipcRenderer.invoke('run:status', { taskId, targetId }),
      defaultUrl: (taskId: string) => ipcRenderer.invoke('run:defaultUrl', taskId),
    },
    // Local-changes review (docs/panes.md): working-tree status/diffs/blobs for the ChangesPane.
    local: {
      changes: (taskId: string) => ipcRenderer.invoke('local:changes', taskId),
      diff: (taskId: string, path: string, scope: 'unstaged' | 'staged') => ipcRenderer.invoke('local:diff', { taskId, path, scope }),
      blob: (taskId: string, path: string, ref?: string) => ipcRenderer.invoke('local:blob', { taskId, path, ref }),
      // Stage/commit actions (docs/panes.md). Discard is confirmed in the renderer first.
      stage: (taskId: string, path: string) => ipcRenderer.invoke('local:stage', { taskId, path }),
      unstage: (taskId: string, path: string) => ipcRenderer.invoke('local:unstage', { taskId, path }),
      discard: (taskId: string, path: string, untracked?: boolean) => ipcRenderer.invoke('local:discard', { taskId, path, untracked }),
      commit: (taskId: string, message: string) => ipcRenderer.invoke('local:commit', { taskId, message }),
      stageAll: (taskId: string) => ipcRenderer.invoke('local:stageAll', { taskId }),
      unstageAll: (taskId: string) => ipcRenderer.invoke('local:unstageAll', { taskId }),
      discardAll: (taskId: string) => ipcRenderer.invoke('local:discardAll', { taskId }),
      push: (taskId: string) => ipcRenderer.invoke('local:push', { taskId }),
    },
    // Resolve a workspace's browser-preview URL by running its configured script in the task's
    // worktree (script mode only — url/port are computed client-side). Returns the trimmed stdout.
    previewUrl: (taskId: string, script: string) => ipcRenderer.invoke('term:previewUrl', { taskId, script }),
    task: {
      // Guarded archive + worktree teardown (docs/workspaces 05). Lives on the terminal bridge
      // because teardown needs the main-process git + live session map.
      archive: (id: string, opts?: { deleteWorktree?: boolean; force?: boolean; skipTeardown?: boolean }) => ipcRenderer.invoke('term:task:archive', id, opts),
      // Notify main a task was created, so it can run the setup script now if configured to.
      onCreated: (id: string) => ipcRenderer.invoke('term:task:onCreated', id),
      // Point a task at the mapped checkout (no isolated worktree) + adopt its current branch.
      useCheckout: (id: string) => ipcRenderer.invoke('term:task:useCheckout', id),
      // Live worktree statuses (dirty / missing) for the rail + footer markers.
      statuses: () => ipcRenderer.invoke('term:task:statuses'),
    },
    write: (id: string, data: string) => ipcRenderer.send('term:input', { id, data }),
    // Bracketed-paste delivery into an agent PTY (docs/panes.md).
    sendToAgent: (sessionId: string, text: string, submit: 'now' | 'after-ready' | 'draft') =>
      ipcRenderer.invoke('term:sendToAgent', { sessionId, text, submit }),
    // Workflows (docs/next 14): start/list/inspect runs + the human-gate verdict; notices feed the bell.
    workflow: {
      defs: (taskId: string) => ipcRenderer.invoke('workflow:defs', taskId),
      start: (taskId: string, def: unknown) => ipcRenderer.invoke('workflow:start', { taskId, def }),
      runs: (taskId: string) => ipcRenderer.invoke('workflow:runs', taskId),
      steps: (runId: string) => ipcRenderer.invoke('workflow:steps', runId),
      gate: (runId: string, stepId: string, approved: boolean) => ipcRenderer.invoke('workflow:gate', { runId, stepId, approved }),
      onNotice: (cb: (n: { taskId: string; kind: string; title: string }) => void) => {
        const listener = (_e: IpcRendererEvent, n: { taskId: string; kind: string; title: string }) => cb(n)
        ipcRenderer.on('workflow:notice', listener)
        return () => ipcRenderer.removeListener('workflow:notice', listener)
      },
    },
    // Subscribe to session-status pings (idle/exit changes for any session); returns unsubscribe.
    onStatus: (cb: () => void) => {
      const listener = () => cb()
      ipcRenderer.on('term:status', listener)
      return () => ipcRenderer.removeListener('term:status', listener)
    },
    // Subscribe to one session's output; returns an unsubscribe. Detaching keeps the PTY running.
    attach: (id: string, on: (m: ServerMsg) => void) => {
      const listener = (_e: IpcRendererEvent, m: ServerMsg) => on(m)
      ipcRenderer.on(`term:out:${id}`, listener)
      ipcRenderer.send('term:attach', id)
      return () => {
        ipcRenderer.removeListener(`term:out:${id}`, listener)
        ipcRenderer.send('term:detach', id)
      }
    },
  },
  // Drivable browser (docs/panes.md): bind the task's preview webview so main can drive it via CDP.
  browser: {
    bind: (taskId: string, webContentsId: number) => ipcRenderer.invoke('browser:bind', { taskId, webContentsId }),
  },
  // MCP config inspector (docs/mcp.md): known candidate files only, secrets masked in main.
  mcp: {
    inspect: (taskId: string) => ipcRenderer.invoke('mcp:inspect', taskId),
    createStarter: (taskId: string) => ipcRenderer.invoke('mcp:createStarter', taskId),
  },
  // Memory (docs/next 12): committed .acorn/memory files + the derived FTS index.
  memory: {
    list: (repo?: string) => ipcRenderer.invoke('memory:list', { repo }),
    search: (query: string, repo?: string, type?: string) => ipcRenderer.invoke('memory:search', { query, repo, type }),
    add: (p: { taskId: string; scope: 'repo' | 'private'; name: string; description: string; type: string; body: string }) =>
      ipcRenderer.invoke('memory:add', p),
    // The human gate over auto-generated proposals (docs/next 12 P3).
    proposals: (taskId?: string) => ipcRenderer.invoke('memory:proposals', taskId),
    resolveProposal: (id: string, approved: boolean, edited?: { name: string; type: string; description: string; body: string }) =>
      ipcRenderer.invoke('memory:proposal:resolve', { id, approved, edited }),
  },
  // Workspace notes (docs/notes-and-memory.md): .md files with frontmatter under the app data dir; the pane
  // and (later) the MCP notes_* tools share the one main-process store.
  notes: {
    list: (workspaceId: string) => ipcRenderer.invoke('notes:list', workspaceId),
    read: (workspaceId: string, slug: string) => ipcRenderer.invoke('notes:read', { workspaceId, slug }),
    create: (workspaceId: string, title: string, kind?: string) => ipcRenderer.invoke('notes:create', { workspaceId, title, kind }),
    write: (workspaceId: string, slug: string, body: string) => ipcRenderer.invoke('notes:write', { workspaceId, slug, body }),
    setIncluded: (workspaceId: string, slug: string, included: boolean) => ipcRenderer.invoke('notes:setIncluded', { workspaceId, slug, included }),
    remove: (workspaceId: string, slug: string) => ipcRenderer.invoke('notes:remove', { workspaceId, slug }),
  },
  // Monaco editor pane: read/write files on the task's worktree. Separate bridge from `terminal`
  // (own IPC channels), though the handlers share the main-process git/worktree resolution.
  editor: {
    root: (taskId: string) => ipcRenderer.invoke('editor:root', taskId),
    list: (taskId: string, relPath: string) => ipcRenderer.invoke('editor:list', { taskId, relPath }),
    files: (taskId: string) => ipcRenderer.invoke('editor:files', taskId),
    read: (taskId: string, relPath: string) => ipcRenderer.invoke('editor:read', { taskId, relPath }),
    write: (taskId: string, relPath: string, content: string) =>
      ipcRenderer.invoke('editor:write', { taskId, relPath, content }),
  },
  // Find-in-files pane: ripgrep over the task's worktree. Separate bridge from `editor` (own IPC
  // channel), though both resolve the worktree from taskId in the main process.
  search: {
    findInFiles: (taskId: string, query: string, opts: import('../shared/search').SearchOpts) =>
      ipcRenderer.invoke('search:findInFiles', { taskId, query, opts }),
  },
  // Database pane (docs/pg.md): a per-task Postgres connection, resolved on demand from the
  // worktree (never persisted). Browse tables/rows + run SQL + edit rows over IPC.
  database: {
    connect: (taskId: string) => ipcRenderer.invoke('db:connect', taskId),
    disconnect: (taskId: string) => ipcRenderer.invoke('db:disconnect', taskId),
    tables: (taskId: string) => ipcRenderer.invoke('db:tables', taskId),
    columns: (taskId: string, schema: string, name: string) => ipcRenderer.invoke('db:columns', { taskId, schema, name }),
    rows: (taskId: string, schema: string, name: string, offset?: number) => ipcRenderer.invoke('db:rows', { taskId, schema, name, offset }),
    query: (taskId: string, sql: string) => ipcRenderer.invoke('db:query', { taskId, sql }),
    update: (taskId: string, schema: string, name: string, column: string, value: string | null, pk: Record<string, string | null>) =>
      ipcRenderer.invoke('db:update', { taskId, schema, name, column, value, pk }),
    insert: (taskId: string, schema: string, name: string, values: Record<string, string | null>) =>
      ipcRenderer.invoke('db:insert', { taskId, schema, name, values }),
    remove: (taskId: string, schema: string, name: string, pk: Record<string, string | null>) =>
      ipcRenderer.invoke('db:delete', { taskId, schema, name, pk }),
  },
})
