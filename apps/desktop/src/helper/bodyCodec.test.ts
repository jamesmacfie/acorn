import { describe, expect, it } from 'vitest'
import { encodeBytes, decodeBytes } from '../shell/wire'
import { encodeResponseBody } from './bodyCodec'

describe('native helper response bodies', () => {
  it.each([new Uint8Array(), Uint8Array.from({ length: 256 }, (_, i) => i), new TextEncoder().encode('a\u0000海🙂'), new Uint8Array([99, 0, 255, 4, 88]).subarray(1, 4), new Uint8Array(2 * 1024 * 1024).fill(127)])('keeps the portable wire spelling and exact byte view', (bytes) => {
    const encoded = encodeResponseBody(bytes)
    expect(encoded).toBe(encodeBytes(bytes))
    expect(decodeBytes(encoded)).toEqual(bytes)
  })
})
