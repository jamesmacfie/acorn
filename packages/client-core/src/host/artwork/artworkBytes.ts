import { ARTWORK_MAX_PIXELS } from '@acorn/protocol/artwork.ts'

// What a plugin's artwork route really sent, read from the bytes rather than the content type. A
// header that claims one format and holds another, an animation, or a picture past the pixel ceiling
// is refused here, before any decoder or object URL sees it.

type ArtworkType = 'image/png' | 'image/jpeg' | 'image/webp'
export type ArtworkInspection =
  | { ok: true; type: ArtworkType; width: number; height: number }
  | { ok: false; failure: 'format' | 'animated' | 'dimensions' | 'corrupt' }

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + length))
const u16be = (bytes: Uint8Array, at: number): number => (bytes[at] << 8) | bytes[at + 1]
const u16le = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8)
const u24le = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
const u32be = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function png(bytes: Uint8Array): ArtworkInspection {
  if (bytes.length < 33 || ascii(bytes, 12, 4) !== 'IHDR') return { ok: false, failure: 'corrupt' }
  const size = { width: u32be(bytes, 16), height: u32be(bytes, 20) }
  // An APNG declares `acTL` before its first image data. Every chunk before `IDAT` is checked.
  for (let at = 8; at + 8 <= bytes.length;) {
    const type = ascii(bytes, at + 4, 4)
    if (type === 'acTL') return { ok: false, failure: 'animated' }
    if (type === 'IDAT') return { ok: true, type: 'image/png', ...size }
    at += 12 + u32be(bytes, at)
  }
  return { ok: false, failure: 'corrupt' }
}

function jpeg(bytes: Uint8Array): ArtworkInspection {
  for (let at = 2; at + 4 <= bytes.length;) {
    if (bytes[at] !== 0xff) return { ok: false, failure: 'corrupt' }
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at++
      continue
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    // The start of scan or end of image, with no frame header before it.
    if (marker === 0xda || marker === 0xd9) return { ok: false, failure: 'corrupt' }
    // Every start-of-frame marker but DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > bytes.length) return { ok: false, failure: 'corrupt' }
      return { ok: true, type: 'image/jpeg', height: u16be(bytes, at + 5), width: u16be(bytes, at + 7) }
    }
    at += 2 + u16be(bytes, at + 2)
  }
  return { ok: false, failure: 'corrupt' }
}

function webp(bytes: Uint8Array): ArtworkInspection {
  if (bytes.length < 30) return { ok: false, failure: 'corrupt' }
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return { ok: false, failure: 'corrupt' }
    return { ok: true, type: 'image/webp', width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return { ok: false, failure: 'corrupt' }
    const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0
    return { ok: true, type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') {
    if (bytes[20] & 0x02) return { ok: false, failure: 'animated' }
    return { ok: true, type: 'image/webp', width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 }
  }
  return { ok: false, failure: 'corrupt' }
}

/** The format and size the bytes hold, or why they can't be shown. Static PNG, JPEG and WebP only. */
export function inspectArtwork(bytes: Uint8Array): ArtworkInspection {
  const found = PNG_SIGNATURE.every((value, index) => bytes[index] === value)
    ? png(bytes)
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? jpeg(bytes)
      : bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
        ? webp(bytes)
        : ({ ok: false, failure: 'format' } as const)
  if (!found.ok) return found
  if (!found.width || !found.height || found.width * found.height > ARTWORK_MAX_PIXELS)
    return { ok: false, failure: 'dimensions' }
  return found
}
