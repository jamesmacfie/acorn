const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/**
 * A bundle's SHA-256 as a host name: RFC 4648 base32, lowercase, no padding. That is 52 characters
 * where hex takes 64, and a DNS label stops at 63. The phone's relay page (apps/mobile/sandbox/worker-host.js)
 * encodes the hash of the bytes it is given the same way and compares the result with its own label.
 */
export const bundleLabel = (hash: string): string => {
  let label = ''
  let buffer = 0
  let bits = 0
  for (let at = 0; at < hash.length; at += 2) {
    buffer = (buffer << 8) | parseInt(hash.slice(at, at + 2), 16)
    bits += 8
    for (; bits >= 5; bits -= 5) label += ALPHABET[(buffer >> (bits - 5)) & 31]
    buffer &= (1 << bits) - 1
  }
  return bits ? label + ALPHABET[(buffer << (5 - bits)) & 31] : label
}
