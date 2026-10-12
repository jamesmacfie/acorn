import { describe, expect, it } from 'vitest'
import { NATIVE_REPLY_CHUNK_CHARS } from '@acorn/protocol/extensionBridge.ts'
import { FrameError, encodeMessage, frameReader } from './framing'

const frame = (body: string): Buffer => {
  const bytes = Buffer.from(body, 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(bytes.length)
  return Buffer.concat([header, bytes])
}

describe('native frame reader', () => {
  it('reads frames split across chunks and several in one chunk', () => {
    const reader = frameReader(1024)
    const both = Buffer.concat([frame('{"a":1}'), frame('{"b":2}')])
    expect(reader.push(both.subarray(0, 6))).toEqual([])
    expect(reader.push(both.subarray(6))).toEqual([
      { ok: true, value: { a: 1 } },
      { ok: true, value: { b: 2 } },
    ])
    expect(reader.pendingBytes()).toBe(0)
  })

  it('throws at an oversized length header before buffering its body', () => {
    const header = Buffer.alloc(4)
    header.writeUInt32LE(1025)
    expect(() => frameReader(1024).push(header)).toThrow(FrameError)
  })

  it('reports a malformed frame and keeps reading the next one', () => {
    expect(frameReader(1024).push(Buffer.concat([frame('{nope'), frame('{"ok":true}')]))).toEqual([
      { ok: false, reason: 'A frame was not valid JSON.' },
      { ok: true, value: { ok: true } },
    ])
  })

  it('holds an unfinished frame as pending bytes', () => {
    const reader = frameReader(1024)
    reader.push(frame('{"a":1}').subarray(0, 7))
    expect(reader.pendingBytes()).toBe(7)
  })
})

describe('native reply encoding', () => {
  it('sends a small reply as one frame', () => {
    const [only, ...rest] = encodeMessage({ v: 1, id: 'r', ok: true, result: { a: 1 } })
    expect(rest).toEqual([])
    expect(JSON.parse(only!.subarray(4).toString())).toEqual({ v: 1, id: 'r', ok: true, result: { a: 1 } })
  })

  it('chunks a large reply below the browser limit, and the chunks rebuild it', () => {
    // Three-byte characters and quotes are the worst cases for the UTF-8 size of a chunk.
    const result = { text: '€"'.repeat(NATIVE_REPLY_CHUNK_CHARS) }
    const frames = encodeMessage({ v: 1, id: 'big', ok: true, result })
    expect(frames.length).toBeGreaterThan(1)
    const chunks = frames.map((buffer) => {
      expect(buffer.readUInt32LE(0)).toBe(buffer.length - 4)
      expect(buffer.length).toBeLessThan(1024 * 1024)
      return JSON.parse(buffer.subarray(4).toString()) as {
        id: string
        chunk: { index: number; count: number; data: string }
      }
    })
    expect(chunks.every((chunk, index) => chunk.id === 'big' && chunk.chunk.index === index)).toBe(true)
    expect(JSON.parse(chunks.map((chunk) => chunk.chunk.data).join(''))).toEqual({ v: 1, id: 'big', ok: true, result })
  })
})
