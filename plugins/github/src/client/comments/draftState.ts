// Persist in-progress GitHub comment/reply drafts in localStorage so they survive navigation and
// reloads — you can leave a PR mid-comment and pick it up later. Per-device, synchronous seed, no
// server round-trip: same rationale as rememberOpen in PullDetail. Drafts clear on successful
// submit because composers set their text to '' afterward, which removes the stored key here.
import { createEffect, on, type Accessor } from 'solid-js'

const PREFIX = 'comment-draft:'

export const readDraft = (key: string): string => localStorage.getItem(PREFIX + key) ?? ''

export const writeDraft = (key: string, value: string): void => {
  if (value) localStorage.setItem(PREFIX + key, value)
  else localStorage.removeItem(PREFIX + key)
}

// Bind a text signal to a keyed draft: reseed the signal when the key (PR/thread context) changes,
// and write back on every edit. A null key disables persistence.
export function persistDraft(
  key: Accessor<string | null>,
  text: Accessor<string>,
  setText: (value: string) => void,
): void {
  createEffect(on(key, (k) => setText(k ? readDraft(k) : '')))
  createEffect(() => {
    const k = key()
    if (k) writeDraft(k, text())
  })
}
