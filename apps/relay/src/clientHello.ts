// The server name in a TLS ClientHello (RFC 8446 § 4.2, RFC 6066 § 3), the one thing the relay reads of
// a preview connection. Everything after it stays ciphertext to the relay.

const HANDSHAKE_RECORD = 22
const CLIENT_HELLO = 1
const SERVER_NAME_EXTENSION = 0
const HOST_NAME = 0
// A record's own limit (RFC 8446 § 5.1). A ClientHello that needs more isn't one.
export const MAX_RECORD_BYTES = 16_384 + 5

export type ClientHello =
  | { status: 'incomplete' }
  | { status: 'invalid' }
  | { status: 'complete'; serverName: string | undefined }

// `bytes` is what has arrived so far. It reads the first record only, which holds the whole ClientHello
// for every browser, because a ClientHello with post-quantum key shares still fits in one record.
export function readClientHello(bytes: Uint8Array): ClientHello {
  if (bytes.length < 5)
    return bytes.length && bytes[0] !== HANDSHAKE_RECORD ? { status: 'invalid' } : { status: 'incomplete' }
  if (bytes[0] !== HANDSHAKE_RECORD || bytes[1] !== 3) return { status: 'invalid' }
  const recordLength = (bytes[3]! << 8) | bytes[4]!
  if (recordLength > MAX_RECORD_BYTES - 5) return { status: 'invalid' }
  if (bytes.length < 5 + recordLength) return { status: 'incomplete' }
  try {
    return { status: 'complete', serverName: serverNameIn(bytes.subarray(5, 5 + recordLength)) }
  } catch {
    return { status: 'invalid' }
  }
}

// A cursor that throws when a field runs past the record, which `readClientHello` turns into 'invalid'.
function serverNameIn(record: Uint8Array): string | undefined {
  let at = 0
  const take = (count: number): Uint8Array => {
    if (at + count > record.length) throw new RangeError('truncated')
    const slice = record.subarray(at, at + count)
    at += count
    return slice
  }
  const number = (width: 1 | 2 | 3): number => take(width).reduce((total, byte) => total * 256 + byte, 0)

  if (number(1) !== CLIENT_HELLO) throw new Error('not a ClientHello')
  number(3) // the handshake length, which the record length already bounds
  take(2 + 32) // version, random
  take(number(1)) // session ID
  take(number(2)) // cipher suites
  take(number(1)) // compression methods
  const extensions = new Uint8Array(take(number(2)))
  for (let next = 0; next + 4 <= extensions.length;) {
    const type = (extensions[next]! << 8) | extensions[next + 1]!
    const size = (extensions[next + 2]! << 8) | extensions[next + 3]!
    const body = extensions.subarray(next + 4, next + 4 + size)
    next += 4 + size
    if (type !== SERVER_NAME_EXTENSION) continue
    // server_name_list: a length, then entries of one type byte and a length-prefixed name.
    for (let entry = 2; entry + 3 <= body.length;) {
      const nameLength = (body[entry + 1]! << 8) | body[entry + 2]!
      if (body[entry] === HOST_NAME)
        return new TextDecoder().decode(body.subarray(entry + 3, entry + 3 + nameLength)).toLowerCase()
      entry += 3 + nameLength
    }
  }
  return undefined
}
