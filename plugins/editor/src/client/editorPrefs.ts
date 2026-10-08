// Which editor the pane's file view mounts. One device preference (`editor_mode`), read from the
// prefs query and written through savePref — the device-prefs pattern, where localStorage is written
// before the query cache (packages/client-core/src/features/settings/savePref.ts).
//
// Graphical is the default and stays it: terminal mode is for a person who already lives in vim.
import type { QueryClient } from '@tanstack/solid-query'
import { PrefKeys, savePref } from '@acorn/plugin-api/client'
import type { Indentation } from './editorPresentation'

export type EditorMode = 'graphical' | 'terminal'

export const readEditorMode = (prefs: Record<string, string> | undefined): EditorMode =>
  prefs?.[PrefKeys.editorMode] === 'terminal' ? 'terminal' : 'graphical'

export const saveEditorMode = (qc: QueryClient, mode: EditorMode): Promise<boolean> =>
  savePref(qc, PrefKeys.editorMode, mode)

export const readEditorWordWrap = (prefs: Record<string, string> | undefined): boolean =>
  prefs?.[PrefKeys.editorWordWrap] === '1'

export const saveEditorWordWrap = (qc: QueryClient, enabled: boolean): Promise<boolean> =>
  savePref(qc, PrefKeys.editorWordWrap, enabled ? '1' : '0')

export const readEditorIndentation = (prefs: Record<string, string> | undefined): Indentation => {
  const match = /^(spaces|tabs):(2|4|8)$/.exec(prefs?.[PrefKeys.editorIndentation] ?? '')
  return match ? { mode: match[1] as Indentation['mode'], width: Number(match[2]) as Indentation['width'] } : { mode: 'spaces', width: 2 }
}

export const saveEditorIndentation = (qc: QueryClient, value: Indentation): Promise<boolean> =>
  savePref(qc, PrefKeys.editorIndentation, `${value.mode}:${value.width}`)
