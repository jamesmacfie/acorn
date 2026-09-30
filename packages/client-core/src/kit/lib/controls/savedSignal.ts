import { createEffect, createSignal, on, onCleanup, type Accessor } from 'solid-js'

/** How long **Saved** stays beside a setting after a write lands. */
export const SAVED_MS = 2000

/** Whether **Saved** is showing for a write that landed at `savedAt()`, as `Date.now()`. True for the
 *  rest of `SAVED_MS` after each new value, then false. Both hosts' `SettingRow` draw from this, so a
 *  page's signal lasts the same time in a window and in a terminal. A row mounted after the fact, such
 *  as one a list rebuilt, shows only what is left of the two seconds. */
export function createSavedSignal(savedAt: Accessor<number | undefined>): Accessor<boolean> {
  const [saved, setSaved] = createSignal(false)
  createEffect(on(savedAt, (at) => {
    setSaved(false)
    const left = at ? at + SAVED_MS - Date.now() : 0
    if (left <= 0) return
    setSaved(true)
    const timer = setTimeout(() => setSaved(false), left)
    onCleanup(() => clearTimeout(timer))
  }))
  return saved
}
