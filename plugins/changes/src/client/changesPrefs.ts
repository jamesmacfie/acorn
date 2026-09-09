// The Changes pane's one device preference: how its list is drawn (`changes_view`). Read from the
// prefs query and written through saveJsonPref — the device-prefs pattern, where localStorage is
// written before the query cache (packages/client-core/src/features/settings/savePref.ts).
//
// The device's, not the node's. Which shape a list is in is about the person reading it, not about
// the worktree, and the other client paired with the same node draws on a screen with different room
// on it (docs/state-ownership.md § Scope rules).
//
// Which backend the commit-message wand spends used to be a second key here. It is now the one
// "Generate with" default every Generate control in the app shares, so the pane reads and writes it
// through `@acorn/plugin-api/client` instead.
import type { QueryClient } from '@tanstack/solid-query'
import { z } from 'zod'
import { PrefKeys, saveJsonPref, type PersistedStateSlice } from '@acorn/plugin-api/client'
import { DEFAULT_CHANGE_VIEW, type ChangeView } from './model'

// Every field optional and every bad field caught on its own, so a value written by an older or
// newer build costs the reader the one choice that no longer parses rather than all three. Unknown
// fields are stripped rather than refused, which is the difference from `z.strictObject`: a build
// that adds a fourth choice must not reset the three this one knows.
const viewSchema = z.object({
  mode: z.enum(['list', 'tree']).optional().catch(undefined),
  sort: z.enum(['path', 'name']).optional().catch(undefined),
  groupBy: z.enum(['none', 'tracked', 'staged']).optional().catch(undefined),
})

export function readChangeView(prefs: Record<string, string> | undefined): ChangeView {
  try {
    const raw = prefs?.[PrefKeys.changesView]
    if (!raw) return DEFAULT_CHANGE_VIEW
    const parsed = viewSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return DEFAULT_CHANGE_VIEW
    // Spread over the defaults, and only the fields that came back: a `catch(undefined)` above leaves
    // the key present and undefined, which would overwrite a default with nothing.
    return {
      mode: parsed.data.mode ?? DEFAULT_CHANGE_VIEW.mode,
      sort: parsed.data.sort ?? DEFAULT_CHANGE_VIEW.sort,
      groupBy: parsed.data.groupBy ?? DEFAULT_CHANGE_VIEW.groupBy,
    }
  } catch {
    return DEFAULT_CHANGE_VIEW
  }
}

export const saveChangeView = (queryClient: QueryClient, next: ChangeView): Promise<boolean> =>
  saveJsonPref(queryClient, PrefKeys.changesView, next)

/** Declares the bound and the lifetime for the persistence layer. No binding: there is nothing to
 *  hydrate at startup, because the pane reads the preference from the prefs query when it mounts. */
export const changeViewSlice: PersistedStateSlice<Record<string, unknown>> = {
  id: 'changes.view',
  key: PrefKeys.changesView,
  scope: 'app',
  restore: 'workspace',
  version: 1,
  codec: {
    parse: (raw) => {
      try {
        const value = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
      } catch {
        return {}
      }
    },
    serialize: (value) => value,
  },
  empty: () => ({}),
  unknownIds: 'retain-inert',
  maxBytes: 1024,
}
