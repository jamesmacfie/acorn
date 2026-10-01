// Internal to Agents. Manifest harnesses supply launch data, never a cross-worker start callback.
export function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted)
      reject(signal.reason)
    }
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
    if (signal.aborted) aborted()
  })
}

export function startCancellation(parent?: AbortSignal): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController()
  const abort = () => controller.abort(parent?.reason)
  parent?.addEventListener('abort', abort, { once: true })
  if (parent?.aborted) abort()
  const timer = setTimeout(() => controller.abort(new Error('Agent startup exceeded 60 seconds.')), 60_000)
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
    },
  }
}
