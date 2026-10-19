import { describe, expect, it } from 'vitest'
import { inspectArtwork } from './artworkBytes'
import { jpegBytes, pngBytes, webpBytes } from './artworkFixtures.helper'

describe('artwork inspection', () => {
  it('reads the format and size from static PNG, JPEG and WebP headers', () => {
    expect(inspectArtwork(pngBytes(300, 200))).toEqual({ ok: true, type: 'image/png', width: 300, height: 200 })
    expect(inspectArtwork(jpegBytes(640, 480))).toEqual({ ok: true, type: 'image/jpeg', width: 640, height: 480 })
    expect(inspectArtwork(webpBytes(1000, 1000))).toEqual({ ok: true, type: 'image/webp', width: 1000, height: 1000 })
  })

  it('refuses animation, other formats, oversized pictures, and truncated headers', () => {
    expect(inspectArtwork(pngBytes(64, 64, { animated: true }))).toEqual({ ok: false, failure: 'animated' })
    expect(inspectArtwork(webpBytes(64, 64, { animated: true }))).toEqual({ ok: false, failure: 'animated' })
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(inspectArtwork(svg)).toEqual({ ok: false, failure: 'format' })
    expect(inspectArtwork(new TextEncoder().encode('GIF89a......'))).toEqual({ ok: false, failure: 'format' })
    expect(inspectArtwork(pngBytes(5_000, 4_000))).toEqual({ ok: false, failure: 'dimensions' })
    expect(inspectArtwork(pngBytes(0, 10))).toEqual({ ok: false, failure: 'dimensions' })
    expect(inspectArtwork(pngBytes().subarray(0, 30))).toEqual({ ok: false, failure: 'corrupt' })
    expect(inspectArtwork(jpegBytes().subarray(0, 12))).toEqual({ ok: false, failure: 'corrupt' })
  })
})
