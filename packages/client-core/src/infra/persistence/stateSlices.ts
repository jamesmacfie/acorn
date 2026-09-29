import { homeTabSlice } from '../../features/dashboards/homeTab'
import { dashboardsSlice } from '../../features/dashboards/persist'
import { hydrateNoticeValues, notices, type Notice } from '../../features/notifications/notifications'
import { defaultLayout, normalizeLayout, type TaskLayout } from '../../features/tasks/taskLayout'
import { hydrateTaskLayout, hydrateWorkspaceView, taskLayouts, workspaceViews } from '../../features/tasks/tasks'
import { currentWorkspaceId, hydrateWorkspaceHistory, workspaceHistory, type WorkspaceHistory } from '../../features/workspaces/lastWorkspace'
import type { WorkspaceView } from '../../features/workspaces/workspaceViewTransition'
import { PrefKeys, PersistedSliceKeys } from './prefKeys'
import { appStateBinding, parseJson, type PersistedStateSlice } from './persistedState'

// Core-owned persisted state only: the task layout (core owns panes), notices (core owns the
// notification centre) and the dashboard model (core owns panels). Feature-owned slices live next
// to the store they bind, the dashboards one does, and is re-exported here rather than redeclared
// so the composition root keeps registering one list. See
// plugins/{editor/client/openFilesSlice,github/client/pullList/filterSlice,context/client/selectionSlice}.ts;
// each plugin registers its own through `ctx.persistedStateSlices` in its client/index.ts. The
// composition root registers only these and the direct preference slices (app/client/activate.ts).

const taskLayoutSlice: PersistedStateSlice<TaskLayout> = {
  id: 'core.task-layouts',
  key: PersistedSliceKeys.taskLayouts,
  scope: 'task',
  restore: 'panes',
  version: 1,
  codec: {
    parse: (raw) => normalizeLayout(parseJson(raw)) ?? defaultLayout(),
    serialize: (layout) => layout,
  },
  empty: () => defaultLayout(),
  unknownIds: 'retain-inert',
  maxBytes: 32 * 1024,
  binding: {
    values: taskLayouts,
    hydrate: hydrateTaskLayout,
  },
}

// Where you were looking in one workspace: a rail source, or a task. An unreadable value parses to
// an empty source, which `hydrateWorkspaceView` declines to restore — the workspace then opens on
// its default, which is what it did before any of this was remembered.
const parseWorkspaceView = (raw: unknown): WorkspaceView => {
  const value = parseJson(raw)
  if (value && typeof value === 'object') {
    const candidate = value as { source?: unknown; path?: unknown; taskId?: unknown }
    if (typeof candidate.source === 'string') {
      return typeof candidate.path === 'string' ? { source: candidate.source, path: candidate.path } : { source: candidate.source }
    }
    if (typeof candidate.taskId === 'string') return { taskId: candidate.taskId }
  }
  return { source: '' }
}

// One key per workspace rather than one map under an app key, so a workspace going away tombstones
// its own entry instead of rewriting everybody's (persistence/startupRestore.ts).
export const workspaceViewSlice: PersistedStateSlice<WorkspaceView> = {
  id: 'core.workspace-views',
  key: PersistedSliceKeys.workspaceViews,
  scope: 'workspace',
  // The first phase, ahead of anything that restores a selection. The terminal client reopens on a
  // workspace by replaying a switch into it, and a switch reads this memory (apps/tui/src/chrome/restore.ts).
  restore: 'workspace',
  version: 1,
  codec: { parse: parseWorkspaceView, serialize: (view) => view },
  empty: () => ({ source: '' }),
  // A source a plugin contributes is only on offer where that plugin is installed and its provider
  // connected, so a view naming one has to survive being read on a client that cannot draw it.
  unknownIds: 'retain-inert',
  // Room for a page address beside the source.
  maxBytes: 2 * 1024,
  binding: {
    values: workspaceViews,
    hydrate: hydrateWorkspaceView,
  },
}

const parseWorkspaceHistory = (raw: unknown): WorkspaceHistory => {
  const value = parseJson(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { current: null, previous: null }
  const candidate = value as { current?: unknown; previous?: unknown }
  const current = typeof candidate.current === 'string' && candidate.current ? candidate.current : null
  const previous = current && typeof candidate.previous === 'string' && candidate.previous && candidate.previous !== current
    ? candidate.previous : null
  return { current, previous }
}

// The shortcut's pair is a client navigation choice, but both hosts already persist their last
// workspace through the Node preference path. Keeping the pair beside that value makes the terminal
// client durable too; a workspace on another Node remains an id until the desktop resolves the fleet.
export const workspaceHistorySlice: PersistedStateSlice<WorkspaceHistory> = {
  id: 'core.workspace-history',
  key: PrefKeys.workspaceHistory,
  scope: 'app',
  restore: 'workspace',
  version: 1,
  codec: { parse: parseWorkspaceHistory, serialize: (value) => value },
  empty: () => ({ current: null, previous: null }),
  unknownIds: 'retain-inert',
  maxBytes: 1024,
  binding: appStateBinding(workspaceHistory, hydrateWorkspaceHistory),
}

// Which workspace was open, so a launch knows which workspace's memory above to reopen. Both clients
// write it, and each decides what restoring it means, so `hydrate` is theirs: the terminal replays a
// switch (apps/tui/src/chrome/restore.ts), the desktop waits for the whole pass and then opens it
// (apps/desktop/src/client/App.tsx). The node's rather than the device's for the reason the memory
// above is: the terminal has no `localStorage`.
export const lastWorkspaceSlice = (hydrate: (workspaceId: string) => void): PersistedStateSlice<string> => {
  // Written back until a workspace is open. The pass can write before the client has settled on one,
  // and a boot that fails in that gap flushes its pending writes as it is torn down, which used to
  // save an empty value over the right one.
  let saved = ''
  return {
    id: 'core.last-workspace',
    key: PrefKeys.lastWorkspace,
    scope: 'app',
    // After `core.workspace-views`, because the terminal's switch reads that memory.
    restore: 'view',
    version: 1,
    codec: { parse: (raw) => (typeof raw === 'string' ? raw : ''), serialize: (value) => value },
    empty: () => '',
    unknownIds: 'drop',
    maxBytes: 512,
    binding: appStateBinding(() => currentWorkspaceId() ?? saved, (value) => {
      saved = value
      hydrate(value)
    }),
  }
}

const parseNotices = (raw: unknown): Notice[] => {
  const value = parseJson(raw)
  if (!Array.isArray(value)) return []
  return value.filter((notice): notice is Notice => {
    if (!notice || typeof notice !== 'object') return false
    const candidate = notice as Partial<Notice>
    return typeof candidate.id === 'string'
      && typeof candidate.taskId === 'string'
      && typeof candidate.kind === 'string'
      && typeof candidate.title === 'string'
      && typeof candidate.at === 'number'
      && typeof candidate.read === 'boolean'
  })
}

const noticesSlice: PersistedStateSlice<Notice[]> = {
  id: 'core.notices',
  key: PrefKeys.notices,
  scope: 'app',
  restore: 'view',
  version: 1,
  codec: { parse: parseNotices, serialize: (value) => value },
  empty: () => [],
  unknownIds: 'retain-inert',
  maxBytes: 64 * 1024,
  binding: appStateBinding(notices, hydrateNoticeValues),
}

export const coreStateSlices: readonly PersistedStateSlice<unknown>[] = [
  taskLayoutSlice,
  workspaceViewSlice,
  noticesSlice,
  dashboardsSlice,
  homeTabSlice,
] as readonly PersistedStateSlice<unknown>[]
