// Which editor the pane's file view mounts. One device preference (`editor_mode`), read from the
// prefs query and written through savePref — the device-prefs pattern, where localStorage is written
// before the query cache (packages/client-core/src/features/settings/savePref.ts).
//
// Graphical is the default and stays it: terminal mode is for a person who already lives in vim.
import type { QueryClient } from '@tanstack/solid-query'
import { PrefKeys, savePref } from '@acorn/plugin-api/client'

export type EditorMode = 'graphical' | 'terminal'

export const readEditorMode = (prefs: Record<string, string> | undefined): EditorMode =>
  prefs?.[PrefKeys.editorMode] === 'terminal' ? 'terminal' : 'graphical'

export const saveEditorMode = (qc: QueryClient, mode: EditorMode): Promise<boolean> =>
  savePref(qc, PrefKeys.editorMode, mode)
