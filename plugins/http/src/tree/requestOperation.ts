// SDK calls support AbortSignal. Also settle local state if a carrier retires before replying.
export async function withAbort<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  let abort!: () => void
  const canceled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([work(), canceled]) }
  finally { signal.removeEventListener('abort', abort) }
}
