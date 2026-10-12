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
// trusted to resynchronise, so the host closes instead of allocating what the header asks for.
export function frameReader(maxBytes: number) {
  let buffered: Buffer = Buffer.alloc(0)
  return {
    push(chunk: Buffer): Frame[] {
      buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk
      const frames: Frame[] = []
      while (buffered.length >= 4) {
        const length = buffered.readUInt32LE(0)
        if (length > maxBytes) throw new FrameError(`A ${length}-byte frame exceeds the ${maxBytes}-byte limit.`)
        if (buffered.length < 4 + length) break
        const body = buffered.subarray(4, 4 + length).toString('utf8')
        buffered = buffered.subarray(4 + length)
        try {
          frames.push({ ok: true, value: JSON.parse(body) })
        } catch {
          frames.push({ ok: false, reason: 'A frame was not valid JSON.' })
        }
      }
      return frames
    },
    // Bytes of a frame that never finished. Non-zero at end of input means a transfer was cut short.
    pendingBytes: () => buffered.length,
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
