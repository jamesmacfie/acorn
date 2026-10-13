import {
  BROWSER_BRIDGE_PROTOCOL_VERSION,
  NATIVE_REPLY_CHUNK_CHARS,
  type BridgeHostMessage,
} from '@acorn/protocol/extensionBridge.ts'

// Native messaging framing: a 32-bit length in native byte order, then that many bytes of UTF-8 JSON.
// Every platform this release supports is little-endian.

export type Frame = { ok: true; value: unknown } | { ok: false; reason: string }

export class FrameError extends Error {}

// Reads frames from a byte stream. A length header above the bound throws: the stream can't be
// trusted to resynchronise, so the host closes instead of buffering what the header asks for. Chunks
// are kept apart until a whole frame is in, because an upload frame arrives as hundreds of pipe reads
// and joining on each one would copy it hundreds of times.
export function frameReader(maxBytes: number) {
  let chunks: Buffer[] = []
  let buffered = 0
  const joined = (): Buffer => {
    if (chunks.length > 1) chunks = [Buffer.concat(chunks, buffered)]
    return chunks[0]!
  }
  return {
    push(chunk: Buffer): Frame[] {
      chunks.push(chunk)
      buffered += chunk.length
      const frames: Frame[] = []
      while (buffered >= 4) {
        const length = (chunks[0]!.length >= 4 ? chunks[0]! : joined()).readUInt32LE(0)
        if (length > maxBytes) throw new FrameError(`A ${length}-byte frame exceeds the ${maxBytes}-byte limit.`)
        if (buffered < 4 + length) break
        const all = joined()
        const body = all.subarray(4, 4 + length).toString('utf8')
        const rest = all.subarray(4 + length)
        chunks = rest.length ? [rest] : []
        buffered = rest.length
        try {
          frames.push({ ok: true, value: JSON.parse(body) })
        } catch {
          frames.push({ ok: false, reason: 'A frame was not valid JSON.' })
        }
      }
      return frames
    },
    // Bytes of a frame that never finished. Non-zero at end of input means a transfer was cut short.
    pendingBytes: () => buffered,
  }
}

const frame = (value: unknown): Buffer => {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length)
  return Buffer.concat([header, body])
}

// One frame, or chunk frames for a reply too large for the browser to accept in one message.
export function encodeMessage(message: BridgeHostMessage): Buffer[] {
  const json = JSON.stringify(message)
  if (json.length <= NATIVE_REPLY_CHUNK_CHARS || !('id' in message)) return [frame(message)]
  const count = Math.ceil(json.length / NATIVE_REPLY_CHUNK_CHARS)
  return Array.from({ length: count }, (_, index) =>
    frame({
      v: BROWSER_BRIDGE_PROTOCOL_VERSION,
      id: message.id,
      chunk: {
        index,
        count,
        data: json.slice(index * NATIVE_REPLY_CHUNK_CHARS, (index + 1) * NATIVE_REPLY_CHUNK_CHARS),
      },
    }),
  )
}
