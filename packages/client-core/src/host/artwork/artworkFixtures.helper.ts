// The smallest byte strings the artwork checks accept or refuse: headers only, with no image body,
// because inspection never reads past the header.

const u32 = (value: number): number[] => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
const chunk = (type: string, data: number[]): number[] => [
  ...u32(data.length),
  ...[...type].map((c) => c.charCodeAt(0)),
  ...data,
  0,
  0,
  0,
  0,
]
const text = (value: string): number[] => [...value].map((c) => c.charCodeAt(0))

export function pngBytes(width = 64, height = 64, { animated = false } = {}): Uint8Array {
  return new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...(animated ? chunk('acTL', [...u32(2), ...u32(0)]) : []),
    ...chunk('IDAT', [0]),
  ])
}

export function jpegBytes(width = 64, height = 64): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    // An APP0 segment the scan has to step over before it reaches the frame header.
    0xff,
    0xe0,
    0,
    6,
    ...text('JFIF'),
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    3,
    0,
    0,
    0,
  ])
}

export function webpBytes(width = 64, height = 64, { animated = false } = {}): Uint8Array {
  const less = (value: number) => [value - 1, (value - 1) >> 8, (value - 1) >> 16].map((byte) => byte & 255)
  return new Uint8Array([
    ...text('RIFF'),
    22,
    0,
    0,
    0,
    ...text('WEBP'),
    ...text('VP8X'),
    10,
    0,
    0,
    0,
    animated ? 0x02 : 0,
    0,
    0,
    0,
    ...less(width),
    ...less(height),
  ])
}
