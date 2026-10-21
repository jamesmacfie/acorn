import { createComputed, createEffect, createSignal, on, onCleanup, untrack, type Accessor } from 'solid-js'
import type { OpenUIRuntime } from '@acorn/openui-solid'
import { APP_STATE_MAX_BYTES } from '../shared/api'
import { plainData } from './plainData'

// An app's saved `$` variables (docs/agent-built-apps.md § App state). The Node keeps one document per
// app. Every view of the head in one client shares a copy of it: a view writes what its program holds
// into the copy and saves it, and the others take the change, so the last tick wins rather than the
// last view to save.

export type AppState = Record<string, unknown>

/** The copy of the saved document the views of one app share. */
export type SavedState = {
  /** Until the first read answers. A view that couldn't read it starts at the defaults. */
  loading: Accessor<boolean>
  /** The saved document, when it was read. A view that couldn't read it doesn't save over it. */
  current: Accessor<AppState | undefined>
  /** Hands a change to the other views before it's saved. */
  set(state: AppState): void
}

/** A copy for a client whose views of an app don't share one: read once, and kept by this view. */
export function readSavedState(load: () => Promise<AppState>): SavedState {
  const [state, setState] = createSignal<{ loaded: boolean; document?: AppState }>({ loaded: false })
  load().then(
    (document) => setState({ loaded: true, document }),
    () => setState({ loaded: true }),
  )
  return {
    loading: () => !state().loaded,
    current: () => state().document,
    set: (document) => setState({ loaded: true, document }),
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const unchanged = (mine: AppState, saved: AppState) =>
  Object.keys(mine).length === Object.keys(saved).length &&
  Object.entries(mine).every(([name, value]) => name in saved && same(value, saved[name]))
const SAVE_DELAY_MS = 400

/** Seeds a runtime from the saved document, follows the document, and saves what the program sets.
 *  Only variables this revision declares are seeded, so one a revision dropped is gone at its next
 *  save, and a new one starts at its default. */
export function keepState(
  runtime: OpenUIRuntime,
  saved: SavedState,
  save: (state: AppState) => Promise<void>,
  onError: (message: string) => void,
) {
  // Copied to plain data first, because comparing and saving stringify them (plainData says why).
  const variables = (): AppState =>
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
  let pending: AppState | undefined
  const flush = () => {
    clearTimeout(timer)
    const state = pending
    pending = undefined
    if (!state) return
    if (new TextEncoder().encode(JSON.stringify(state)).length > APP_STATE_MAX_BYTES)
      return onError("This app's saved state would be over 256 KiB, so the last change wasn't saved.")
    save(state).catch(() => onError("Couldn't save this app's state. The next change tries again."))
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
