import { describe, expect, it, vi } from 'vitest'
import { dataUrl, MAX_INLINE_IMAGE_BYTES } from './inlineImage'

describe('inline image boundary', () => {
  it('does not allocate a FileReader for oversized or active image types', async () => {
    const reader = vi.spyOn(globalThis, 'FileReader')
    expect(await dataUrl(new Uint8Array(MAX_INLINE_IMAGE_BYTES + 1), 'image/png')).toBeNull()
    expect(await dataUrl(new Uint8Array([1]), 'image/svg+xml')).toBeNull()
    expect(reader).not.toHaveBeenCalled()
    reader.mockRestore()
  })
})
