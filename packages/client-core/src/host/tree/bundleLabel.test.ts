import { describe, expect, it } from 'vitest'
import { bundleLabel } from './bundleLabel'

describe('bundleLabel', () => {
  // Computed with Python's base64.b32encode, lowercased and unpadded.
  it.each([
    [
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      '4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq',
    ],
    [
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      'xj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq',
    ],
  ])('encodes %s as a 52 character label', (hash, label) => {
    expect(bundleLabel(hash)).toBe(label)
    expect(label).toHaveLength(52)
  })
})
