import { createSignal } from 'solid-js'

const widths = new Map<string, ReturnType<typeof createSignal<number>>>()

/** Session width for a split whose owner supplies a resource identity. */
export function listWidthState(key: string): ReturnType<typeof createSignal<number>> {
  let state = widths.get(key)
  if (!state) { state = createSignal(0); widths.set(key, state) }
  return state
}
