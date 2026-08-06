import { hydrateNoticeValues, notices, type Notice } from '../notifications/notifications'
import { defaultLayout, normalizeLayout, parseTaskLayouts, type TaskLayout } from '../tasks/layout'
import { hydrateTaskLayout, taskLayouts } from '../tasks/tasks'
import { PrefKeys, PersistedSliceKeys } from './prefKeys'
import { appStateBinding, parseJson, type PersistedStateSlice } from './persistedState'

// Core-owned persisted state only: the task layout (core owns panes) and notices (core owns the
// notification centre). Feature-owned slices live next to the store they bind — see
// plugins/{editor/client/openFilesSlice,github/client/pullList/filterSlice,context/client/selectionSlice}.ts
// — and each plugin registers its own through `ctx.persistedState` in its client/index.ts. The
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
  legacy: (prefs) => parseTaskLayouts(prefs[PrefKeys.taskLayouts], prefs[PrefKeys.taskPanesLegacy]),
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
  noticesSlice,
] as readonly PersistedStateSlice<unknown>[]
