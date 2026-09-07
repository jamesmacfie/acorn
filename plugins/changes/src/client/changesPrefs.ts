// The Changes pane's two device preferences: how its list is drawn (`changes_view`) and which model
// connection writes a commit message (`changes_generate_connection`). Both read from the prefs query
// and written through saveJsonPref — the device-prefs pattern, where localStorage is written before
// the query cache (packages/client-core/src/features/settings/savePref.ts).
//
// The device's, not the node's. Which shape a list is in is about the person reading it, not about
// the worktree, and the other client paired with the same node draws on a screen with different room
// on it. Which provider you want to spend is yours too, and it should not follow you to a machine
// where you were working on somebody else's budget (docs/state-ownership.md § Scope rules).
import type { QueryClient } from '@tanstack/solid-query'
import { z } from 'zod'
import { PrefKeys, saveJsonPref, type PersistedStateSlice } from '@acorn/plugin-api/client'
import { DEFAULT_CHANGE_VIEW, type ChangeView } from './model'
import type { ModelPick } from '../shared/api'

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

// Which connection the commit-message button spends. A second key rather than a fourth field on
// `changes_view`: the view is about how the list is drawn and this is about whose tokens go, and a
// build that reset one while writing the other would be surprising in both directions.
const pickSchema = z.object({ connectionId: z.string().min(1), modelId: z.string() })

/** The remembered pick, or `null` when there is none this build can read. `null` is the same answer
 *  as "never picked", which is what `effectiveModelPick` wants: it falls back to the first connected
 *  provider either way (./model.ts). */
export function readGeneratePick(prefs: Record<string, string> | undefined): ModelPick | null {
  try {
    const raw = prefs?.[PrefKeys.changesGenerateConnection]
    if (!raw) return null
    const parsed = pickSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const saveGeneratePick = (queryClient: QueryClient, next: ModelPick): Promise<boolean> =>
  saveJsonPref(queryClient, PrefKeys.changesGenerateConnection, next)

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
