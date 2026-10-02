const MAX_BODY_BYTES = 5 * 1024 * 1024

// Reads the body a chunk at a time so a huge or endless response cannot exhaust memory
// (docs/http-client.md § Sending).
export async function readCapped(res: Response, signal = new AbortController().signal): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  signal.throwIfAborted()
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false }
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  const reader = res.body.getReader()
  let stopping: Promise<void> | undefined
  const stop = () => stopping ??= reader.cancel().catch(() => {})
  let retire!: () => void
  const retired = new Promise<void>((resolve) => { retire = resolve })
  const abort = () => { void stop(); retire() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      if (!value) continue
      if (total + value.byteLength > MAX_BODY_BYTES) {
        chunks.push(value.subarray(0, MAX_BODY_BYTES - total))
        total = MAX_BODY_BYTES
        truncated = true
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    await Promise.race([stop(), retired])
    signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
  signal.throwIfAborted()
  const bytes = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  return { bytes, truncated }
}
