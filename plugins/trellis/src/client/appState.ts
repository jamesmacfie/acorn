import { createComputed, createEffect, on, onCleanup, untrack } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { readJson, writeJson } from '@acorn/plugin-api/client'
import type { OpenUIRuntime } from '@acorn/openui-solid'
import { appStateRoute } from '../shared/api'
import { plainData } from './plainData'

// An app's saved `$` variables (docs/agent-built-apps.md § App state). The Node keeps one document per
// app. Every open view of the head, a card and the pane at once included, shares one cache entry: a
// view writes what its program holds into it and saves it, and the others take the change, so the
// last tick wins rather than the last view to save.

type State = Record<string, unknown>
type SavedState = ReturnType<typeof createSavedState>

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const unchanged = (mine: State, saved: State) =>
  Object.keys(mine).length === Object.keys(saved).length &&
  Object.entries(mine).every(([name, value]) => name in saved && same(value, saved[name]))
const SAVE_DELAY_MS = 400

export function createSavedState(nodeId: string, appId: string) {
  const queryClient = useQueryClient()
  const key = ['trellis-state', nodeId, appId]
  const query = createQuery(() => ({
    queryKey: key,
    queryFn: async () => (await readJson<{ state: State }>(appStateRoute(appId), { nodeId })).state,
    // Views of this window write the cache themselves; another window's ticks arrive on the next open.
    staleTime: Infinity,
  }))
  return {
    /** Until the first read answers. A view that couldn't read it starts at the defaults. */
    loading: () => query.isPending,
    /** The saved document, when it was read. A view that couldn't read it doesn't save over it. */
    current: (): State | undefined => (query.isSuccess ? query.data : undefined),
    set: (state: State) => queryClient.setQueryData(key, state),
    save: (state: State) =>
      writeJson(appStateRoute(appId), {
        method: 'PUT',
        nodeId,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state }),
      }),
  }
}

/** Seeds a runtime from the saved document, follows the document, and saves what the program sets.
 *  Only variables this revision declares are seeded, so one a revision dropped is gone at its next
 *  save, and a new one starts at its default. */
export function keepState(runtime: OpenUIRuntime, saved: SavedState, onError: (message: string) => void) {
  // Copied to plain data first, because comparing and saving stringify them (plainData says why).
  const variables = (): State =>
    Object.fromEntries(
      Object.entries(runtime.snapshot())
        .filter(([name]) => name.startsWith('$') && name !== '$placement')
        .map(([name, value]) => [name, plainData(value) ?? null]),
    )

  createComputed(() => {
    const document = saved.current()
    if (!document) return
    untrack(() => {
      const declared = variables()
      for (const [name, value] of Object.entries(document))
        if (name in declared && !same(declared[name], value)) runtime.setState(name, value)
    })
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: State | undefined
  const flush = () => {
    clearTimeout(timer)
    const state = pending
    pending = undefined
    if (!state) return
    saved.save(state).catch((error: unknown) => {
      onError(
        (error as { status?: unknown } | null)?.status === 413
          ? "This app's saved state would be over 256 KiB, so the last change wasn't saved."
          : "Couldn't save this app's state. The next change tries again.",
      )
    })
  }
  createEffect(
    on(
      variables,
      (mine) => {
        const document = saved.current()
        if (!document || unchanged(mine, document)) return
        saved.set(mine)
        pending = mine
        clearTimeout(timer)
        timer = setTimeout(flush, SAVE_DELAY_MS)
      },
      { defer: true },
    ),
  )
  onCleanup(flush)
}
