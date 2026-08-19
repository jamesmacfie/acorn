import { describe, expect, it } from 'vitest'
import { inlineUploadImages, uploadImageUrls } from './uploads'

const SHOT = 'https://uploads.linear.app/w/f/abc.png'
const DATA = 'data:image/png;base64,iVBORw0KGgo='

describe('linear uploads', () => {
  it('collects image uploads once each, ignoring plain links and other hosts', () => {
    const body = `![a](${SHOT})\n![b](${SHOT})\n[file](${SHOT})\n![c](https://example.com/x.png)`
    expect(uploadImageUrls(body)).toEqual([SHOT])
  })

  it('swaps only resolved images, and never a link', () => {
    const body = `![a](${SHOT}) and [file](${SHOT})`
    expect(inlineUploadImages(body, { [SHOT]: DATA })).toBe(`![a](${DATA}) and [file](${SHOT})`)
    // Unresolved stays as it was, so a failed fetch degrades to a broken image rather than to nothing.
    expect(inlineUploadImages(body, {})).toBe(body)
  })
})
