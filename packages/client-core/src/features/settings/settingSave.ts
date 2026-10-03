import { createEffect, createSignal, type Accessor } from 'solid-js'
import { withFailuresThrown } from './savePref'

// The save model every settings page shares (docs/frontend/settings.md § Settings). A switch or a select saves
// when it changes. A text field saves on blur or Enter. Either way the row says **Saved** when the
// write lands and the error when it does not, and a text field keeps what was typed after a failure.
//
// These hold the state; `SettingRow` draws it, from `savedAt` and `error`. A form of fields that only
// make sense together is the one thing that does not save this way: it has Save and Cancel, and
// ./unsavedChanges.ts asks before anyone leaves it.

export type SettingSave = {
  /** When the last write landed, for `SettingRow`'s `savedAt`. */
  savedAt: Accessor<number | undefined>
  /** Why the last write failed, for `SettingRow`'s `error`. Cleared when the next one starts. */
  error: Accessor<string | undefined>
  /** Run one write. A write that resolves `false` failed; one that throws failed with its message.
   *  A pref written inside it throws rather than posting a notice (./savePref.ts), so the failure is
   *  said once, on the row. Resolves `false` on a failure, so a switch handed this promise as its
   *  `onChange` result shows the stored value again rather than staying flipped (kit Checkbox). */
  run: (write: () => Promise<unknown>) => Promise<boolean>
}

const FALLBACK = 'Could not save. Try again.'

export function createSettingSave(): SettingSave {
  const [savedAt, setSavedAt] = createSignal<number>()
  const [error, setError] = createSignal<string>()
  // Only the latest write may report. Two quick changes to one switch finish in any order, and the
  // row should say what happened to the value it now shows.
  let latest = 0
  const run = async (write: () => Promise<unknown>): Promise<boolean> => {
    const attempt = ++latest
    setError(undefined)
    try {
      const result = await withFailuresThrown(write)
      if (result === false) throw new Error(FALLBACK)
      if (attempt === latest) setSavedAt(Date.now())
      return true
    } catch (failure) {
      if (attempt === latest) setError(failure instanceof Error && failure.message ? failure.message : FALLBACK)
      return false
    }
  }
  return { savedAt, error, run }
}

export type TextSetting = SettingSave & {
  /** What the field shows: what is being typed, or the stored value when nothing is. */
  value: Accessor<string>
  /** For the field's `onInput`. */
  input: (value: string) => void
  /** For the field's `onChange`, which the kit fires on blur and on Enter. */
  commit: (value: string) => Promise<void>
}

/**
 * A text field on the save model. `value` reads the stored value and `save` writes one, resolving once
 * `value` reads it back: `savePref` does that by writing the cache first, and a route write does it by
 * awaiting its invalidation. A value that fails to save stays in the field with the error beside it, so
 * nothing the person typed is lost to a network blip, and a commit of the stored value writes nothing.
 * `save` may throw to refuse a value, such as a number that does not parse; the message is the error.
 */
export function createTextSetting(options: {
  value: Accessor<string>
  save: (value: string) => Promise<unknown>
}): TextSetting {
  const save = createSettingSave()
  const [draft, setDraft] = createSignal<string>()
  // After a write lands the draft stays until `value` has moved, because a query's cache can reach its
  // readers a tick after the write resolves, and clearing at once would flash the old value. Moved
  // means changed from what it read before the write, which also covers a node that normalises what
  // it stores, such as a branch prefix gaining its slash.
  const [landed, setLanded] = createSignal<{ before: string }>()
  createEffect(() => {
    const waiting = landed()
    if (waiting && options.value() !== waiting.before) {
      setLanded(undefined)
      setDraft(undefined)
    }
  })
  const commit = async (value: string) => {
    if (value === options.value() && !save.error()) {
      setDraft(undefined)
      return
    }
    setDraft(value)
    setLanded(undefined)
    const before = options.value()
    if (!(await save.run(() => options.save(value)))) return
    if (options.value() !== before || options.value() === value) setDraft(undefined)
    else setLanded({ before })
  }
  return {
    ...save,
    value: () => draft() ?? options.value(),
    input: (value) => {
      setLanded(undefined)
      setDraft(value)
    },
    commit,
  }
}
