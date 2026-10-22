// Host-owned code, loaded before the relay page's and the frame page's own script. It is the one place the
// sandbox checks bytes against the name it was served under.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

// The bundle's SHA-256 as base32, which packages/client-core/src/host/tree/bundleLabel.ts writes the same way.
const base32 = (bytes) => {
  let text = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    for (; bits >= 5; bits -= 5) text += ALPHABET[(buffer >> (bits - 5)) & 31]
    buffer &= (1 << bits) - 1
  }
  return bits ? text + ALPHABET[(buffer << (5 - bits)) & 31] : text
}

// A `blob:` URL for the bytes, once they hash to this page's own label. It's never revoked here: a module
// Worker fetches its script after construction, so the caller revokes when it can. A property of the global,
// because the scripts that call it are other files.
globalThis.checkedBundleUrl = async (bundle) => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bundle))
  if (base32(digest) !== location.hostname.split('.')[0]) throw new Error('the bundle does not match this page')
  return URL.createObjectURL(new Blob([bundle], { type: 'text/javascript' }))
}
