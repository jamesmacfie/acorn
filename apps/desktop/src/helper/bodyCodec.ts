import { Buffer } from 'node:buffer'

/** Encodes the precise body view without a JavaScript binary string. */
export function encodeResponseBody(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}
