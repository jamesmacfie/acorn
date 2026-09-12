import { homeTabSlice } from '../../features/dashboards/homeTab'
import { dashboardsSlice } from '../../features/dashboards/persist'
import { hydrateNoticeValues, notices, type Notice } from '../../features/notifications/notifications'
import { defaultLayout, normalizeLayout, type TaskLayout } from '../../features/tasks/taskLayout'
import { hydrateTaskLayout, hydrateWorkspaceView, taskLayouts, workspaceViews } from '../../features/tasks/tasks'
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
    const candidate = value as { source?: unknown; taskId?: unknown }
    if (typeof candidate.source === 'string') return { source: candidate.source }
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
  maxBytes: 512,
  binding: {
    values: workspaceViews,
    hydrate: hydrateWorkspaceView,
  },
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
