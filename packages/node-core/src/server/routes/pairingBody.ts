// Pairing is pre-auth and its two strings fit comfortably in 4 KiB, including UTF-8 and JSON
// escaping. Count wire bytes before decoding or allocating a parsed object.
export const MAX_PAIR_REQUEST_BYTES = 4 * 1024

export async function readPairingBody(request: Request): Promise<{ oversized: true } | { oversized: false; value: unknown }> {
  const declared = request.headers.get('content-length')
  if (declared && /^\d+$/.test(declared) && BigInt(declared) > BigInt(MAX_PAIR_REQUEST_BYTES)) {
    void request.body?.cancel().catch(() => {})
    return { oversized: true }
  }
  const reader = request.body?.getReader()
  if (!reader) return { oversized: false, value: null }
  const bytes = new Uint8Array(MAX_PAIR_REQUEST_BYTES)
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength > MAX_PAIR_REQUEST_BYTES - size) {
        // Do not wait for a hostile source's cancellation before returning the 413.
        void reader.cancel().catch(() => {})
        return { oversized: true }
      }
      bytes.set(value, size)
      size += value.byteLength
    }
    return { oversized: false, value: JSON.parse(new TextDecoder().decode(bytes.subarray(0, size))) as unknown }
  } catch {
    return { oversized: false, value: null }
  } finally {
    reader.releaseLock()
  }
}
