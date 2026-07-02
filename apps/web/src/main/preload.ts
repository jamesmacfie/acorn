import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CreateOpts, ServerMsg } from '../shared/terminal'

// Narrow capability surface (docs/electron.md §4g): expose only a desktop marker and the validated
// terminal channels (vNext §5) — never raw ipcRenderer.
contextBridge.exposeInMainWorld('acorn', {
  desktop: true,
  platform: process.platform,
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
      runConfig: (owner: string, repo: string, runCommand: string, devPort: number) =>
        ipcRenderer.invoke('term:repoPath:runConfig', { owner, repo, runCommand, devPort }),
      // Per-repo external editor command (docs/next 01 P2). Blank clears to the global default.
      editorCommand: (owner: string, repo: string, editorCommand: string) =>
        ipcRenderer.invoke('term:repoPath:editorCommand', { owner, repo, editorCommand }),
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
    // Open the task's worktree in the user's external editor (code/zed/…, docs/next 01 P2).
    openInEditor: (taskId: string) => ipcRenderer.invoke('term:openInEditor', taskId),
    // Local-changes review (docs/next 04): working-tree status/diffs/blobs for the ChangesPane.
    local: {
      changes: (taskId: string) => ipcRenderer.invoke('local:changes', taskId),
      diff: (taskId: string, path: string, scope: 'unstaged' | 'staged') => ipcRenderer.invoke('local:diff', { taskId, path, scope }),
      blob: (taskId: string, path: string, ref?: string) => ipcRenderer.invoke('local:blob', { taskId, path, ref }),
      // Stage/commit actions (docs/next 04 P4). Discard is confirmed in the renderer first.
      stage: (taskId: string, path: string) => ipcRenderer.invoke('local:stage', { taskId, path }),
      unstage: (taskId: string, path: string) => ipcRenderer.invoke('local:unstage', { taskId, path }),
      discard: (taskId: string, path: string, untracked?: boolean) => ipcRenderer.invoke('local:discard', { taskId, path, untracked }),
      commit: (taskId: string, message: string) => ipcRenderer.invoke('local:commit', { taskId, message }),
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
      // Live worktree statuses (dirty / missing) for the rail + footer markers.
      statuses: () => ipcRenderer.invoke('term:task:statuses'),
    },
    write: (id: string, data: string) => ipcRenderer.send('term:input', { id, data }),
    // Bracketed-paste delivery into an agent PTY (docs/next 04 §D).
    sendToAgent: (sessionId: string, text: string, submit: 'now' | 'after-ready' | 'draft') =>
      ipcRenderer.invoke('term:sendToAgent', { sessionId, text, submit }),
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
  // MCP config inspector (docs/next 06 A): known candidate files only, secrets masked in main.
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
  },
  // Workspace notes (docs/next 09): .md files with frontmatter under the app data dir; the pane
  // and (later) the MCP notes_* tools share the one main-process store.
  notes: {
    list: (workspaceId: string) => ipcRenderer.invoke('notes:list', workspaceId),
    read: (workspaceId: string, slug: string) => ipcRenderer.invoke('notes:read', { workspaceId, slug }),
    create: (workspaceId: string, title: string, kind?: string) => ipcRenderer.invoke('notes:create', { workspaceId, title, kind }),
    write: (workspaceId: string, slug: string, body: string) => ipcRenderer.invoke('notes:write', { workspaceId, slug, body }),
    remove: (workspaceId: string, slug: string) => ipcRenderer.invoke('notes:remove', { workspaceId, slug }),
  },
  // Monaco editor pane: read/write files on the task's worktree. Separate bridge from `terminal`
  // (own IPC channels), though the handlers share the main-process git/worktree resolution.
  editor: {
    root: (taskId: string) => ipcRenderer.invoke('editor:root', taskId),
    list: (taskId: string, relPath: string) => ipcRenderer.invoke('editor:list', { taskId, relPath }),
    read: (taskId: string, relPath: string) => ipcRenderer.invoke('editor:read', { taskId, relPath }),
    write: (taskId: string, relPath: string, content: string) =>
      ipcRenderer.invoke('editor:write', { taskId, relPath, content }),
  },
})
