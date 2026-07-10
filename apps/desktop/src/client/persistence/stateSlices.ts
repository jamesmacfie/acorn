import { editorStateByTask, hydrateTaskEditorState, type TaskEditorState } from '../features/editor/editorState'
import { hydrateNoticeValues, notices, type Notice } from '../features/notifications/notifications'
import { hydratePrFilter, prFilters, type PrFilter } from '../features/pullList/filterState'
import { defaultLayout, normalizeLayout, parseTaskLayouts, type TaskLayout } from '../features/tasks/layout'
import { hydrateTaskLayout, taskLayouts } from '../features/tasks/tasks'
import { PrefKeys, PersistedSliceKeys } from './prefKeys'
import { appStateBinding, type PersistedStateSlice } from './persistedState'

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

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

const parseEditorState = (raw: unknown): TaskEditorState => {
  const value = parseJson(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { files: [], active: null }
  const source = value as { files?: unknown; active?: unknown }
  const files = (Array.isArray(source.files) ? source.files : [])
    .filter((file): file is { path: string; ephemeral?: unknown } => {
      return !!file && typeof file === 'object' && typeof (file as { path?: unknown }).path === 'string' && !!(file as { path: string }).path
    })
    .map((file) => ({ path: file.path, ephemeral: file.ephemeral === true, dirty: false }))
  const active = typeof source.active === 'string' && files.some((file) => file.path === source.active)
    ? source.active
    : (files[0]?.path ?? null)
  return { files, active }
}

const editorOpenFilesSlice: PersistedStateSlice<TaskEditorState> = {
  id: 'editor.open-files',
  key: PersistedSliceKeys.editorOpenFiles,
  scope: 'task',
  restore: 'panes',
  version: 1,
  codec: {
    parse: parseEditorState,
    serialize: (state) => ({
      files: state.files.map((file) => ({ path: file.path, ephemeral: file.ephemeral })),
      active: state.active,
    }),
  },
  empty: () => ({ files: [], active: null }),
  unknownIds: 'retain-inert',
  maxBytes: 32 * 1024,
  binding: {
    values: editorStateByTask,
    hydrate: hydrateTaskEditorState,
  },
  legacy: (prefs) => {
    const value = parseJson(prefs[PrefKeys.editorOpenFiles])
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  },
}

const parsePrFilter = (raw: unknown): PrFilter => {
  const value = parseJson(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { tab: 'open', filter: '' }
  const source = value as { tab?: unknown; filter?: unknown }
  return {
    tab: source.tab === 'closed' ? 'closed' : 'open',
    filter: typeof source.filter === 'string' ? source.filter : '',
  }
}

const prFiltersSlice: PersistedStateSlice<PrFilter> = {
  id: 'github.pr-filters',
  key: PersistedSliceKeys.prFilters,
  scope: 'workspace',
  restore: 'view',
  version: 1,
  codec: { parse: parsePrFilter, serialize: (filter) => filter },
  empty: () => ({ tab: 'open', filter: '' }),
  unknownIds: 'drop',
  maxBytes: 4 * 1024,
  binding: { values: prFilters, hydrate: hydratePrFilter },
  legacy: (prefs) => {
    const value = parseJson(prefs[PrefKeys.prFilters])
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
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

export const persistedFeatureSlices: readonly PersistedStateSlice<unknown>[] = [
  taskLayoutSlice,
  editorOpenFilesSlice,
  prFiltersSlice,
  noticesSlice,
] as readonly PersistedStateSlice<unknown>[]

export const persistedStateCodecs = { parseEditorState, parsePrFilter, parseNotices }
