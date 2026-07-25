import { parseJson, type PersistedStateSlice } from '../../../core/client/persistence/persistedState'
import { PrefKeys, PersistedSliceKeys } from '../../../core/client/persistence/prefKeys'
import { editorStateByTask, hydrateTaskEditorState, type TaskEditorState } from './editorState'

// The editor's own persisted-state descriptor: open tabs + active tab, per task. Owned here rather
// than in core so core never has to know which features persist state (docs/plugins.md); registered
// by the composition root in app/client/persistedSliceContributions.ts.
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

export const editorOpenFilesSlice: PersistedStateSlice<TaskEditorState> = {
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
