import type { QueryClient } from '@tanstack/solid-query'
import { defaultModelIdFor, type ModelBackend } from '@acorn/protocol/modelProviders.ts'
import { parseJson } from '../../../infra/persistence/persistedState'
import { PrefKeys } from '../../../infra/persistence/prefKeys'
import { saveJsonPref } from '../savePref'

// The one "Generate with" default, shared by every Generate control in the app: the commit-message
// wand, the SQL dialog, the workflow generator, and the Settings section that edits it on its own
// (./GenerateSettings.tsx).
//
// One default rather than one per dialog because with agent CLIs in the list, re-picking is the
// common case: a person whose only backend is `claude` would otherwise choose it again in every
// dialog they open. The pick a dialog writes is what the next dialog opens on.
//
// The device's, not the node's. The backends a node offers are the same everywhere, but which of them
// you want to spend is yours, and it should not follow you to a machine where you were working on
// somebody else's budget (docs/state-ownership.md § Scope rules). Written through `saveJsonPref`, so
// `localStorage` is written before the query cache — the other way round, `mergePrefs` recomputes
// against the old device value and drops the new one, silently (../savePref.ts).

/** Which backend, and which of its models. Written whole: a model id belongs to one backend, so the
 *  two are only meaningful together. `modelId` is `''` for a backend that declares no catalog, which
 *  is a real answer — the caller omits the model and the backend falls back to its own default. */
export type ModelPick = { backendId: string; modelId: string }

/** The remembered pick, or `null` when there is none this build can read.
 *
 *  `null` is the same answer as "never picked", which is what `effectiveModelPick` below wants: it
 *  falls back to the first available backend either way.
 *
 *  The commit wand once remembered its own pick under a key of its own, and that key is not
 *  migrated. So on a device holding one, the first dialog opened starts on `backends[0]`, and the
 *  pick made there is remembered for every dialog. That is the reasoning the fallback below applies
 *  to a pick whose backend has gone: a device preference is a stale note, not a decision. */
export function readGeneratePick(prefs: Record<string, string> | undefined): ModelPick | null {
  const value = parseJson(prefs?.[PrefKeys.generatePick])
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { backendId, modelId } = value as { backendId?: unknown; modelId?: unknown }
  if (typeof backendId !== 'string' || !backendId) return null
  return typeof modelId === 'string' ? { backendId, modelId } : null
}

export const saveGeneratePick = (queryClient: QueryClient, next: ModelPick): Promise<boolean> =>
  saveJsonPref(queryClient, PrefKeys.generatePick, next)

/** Which backend and model a Generate control will spend, given what is available and what was
 *  remembered.
 *
 *  The remembered pick wins while it still resolves, so a reader who chose Anthropic keeps it. A pick
 *  whose backend has gone falls back to the first backend rather than failing, because a disconnected
 *  provider or an uninstalled CLI in a device preference is a stale note, not a decision to honour.
 *  That backend's own default model is the fallback, which is what `ModelBackendPicker` opens on, so
 *  the picker and a silent path start on the same model by construction.
 *
 *  Backends arrive connections-first (@acorn/protocol/modelProviders.ts), so the fallback keeps
 *  spending the key the owner configured on purpose and reaches for a CLI only when there is no key.
 *
 *  `null` when there is nothing to spend, which is what hides a Generate control. */
export function effectiveModelPick(
  backends: readonly ModelBackend[],
  remembered: ModelPick | null,
): ModelPick | null {
  const held = remembered ? backends.find((candidate) => candidate.id === remembered.backendId) : undefined
  if (remembered && held) {
    // The model is checked against the backend's list too: a provider that dropped a model between
    // releases would otherwise be asked for one it no longer serves.
    const known = held.models.some((model) => model.id === remembered.modelId)
    return { backendId: remembered.backendId, modelId: known ? remembered.modelId : defaultModelIdFor(held) }
  }
  const first = backends[0]
  return first ? { backendId: first.id, modelId: defaultModelIdFor(first) } : null
}
