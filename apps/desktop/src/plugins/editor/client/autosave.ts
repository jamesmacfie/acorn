// Debounce with flush/cancel, for autosave surfaces (notes, editor, settings): input schedules a
// deferred save; blur/switch flushes it now. ponytail: 12 lines over a library.
export type Debounced<A extends unknown[]> = ((...args: A) => void) & { flush: () => void; cancel: () => void }

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: A | undefined
  const run = ((...args: A) => {
    pending = args
    clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; const a = pending; pending = undefined; if (a) fn(...a) }, ms)
  }) as Debounced<A>
  run.flush = () => { if (timer) { clearTimeout(timer); timer = undefined; const a = pending; pending = undefined; if (a) fn(...a) } }
  run.cancel = () => { clearTimeout(timer); timer = undefined; pending = undefined }
  return run
}
