// The transport buffers complete fetch bodies. One cancellation race surrounds the owned drain;
// successful reads leave no reaction attached to a realm-long retirement promise.
export async function readRpcBody(
  body: ReadableStream<Uint8Array>, retirement: AbortSignal, check: () => void,
  cancelled?: Promise<Error>, signal?: AbortSignal,
): Promise<Uint8Array> {
  const reader = body.getReader()
  let reading = true
  let abort!: (error: Error) => void
  const cancellation = new Promise<never>((_, reject) => { abort = reject })
  const stop = (error: Error) => {
    if (!reading) return
    abort(error)
    // An authored stream's cancel hook can also be uncooperative.
    void reader.cancel(error).catch(() => {})
  }
  const onAbort = () => stop(signal?.reason instanceof Error ? signal.reason : new DOMException(String(signal?.reason ?? 'The operation was aborted.'), 'AbortError'))
  const onRetire = () => stop(retirement.reason)
  retirement.addEventListener('abort', onRetire, { once: true })
  signal?.addEventListener('abort', onAbort, { once: true })
  const drain = async (): Promise<Uint8Array> => {
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const read = await reader.read()
      check()
      if (read.done) break
      if (!(read.value instanceof Uint8Array)) throw new TypeError('Plugin RPC body received a non-Uint8Array chunk.')
      chunks.push(read.value)
      length += read.value.byteLength
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes
  }
  try {
    // Race observes the drain's rejection after cancellation as well as its normal completion.
    const read = Promise.race([drain(), cancellation])
    if (retirement.aborted) onRetire()
    if (signal?.aborted) onAbort()
    if (cancelled) void cancelled.then(stop)
    return await read
  } catch (error) {
    void reader.cancel(error).catch(() => {})
    throw error
  } finally {
    reading = false
    signal?.removeEventListener('abort', onAbort)
    retirement.removeEventListener('abort', onRetire)
    reader.releaseLock()
  }
}
