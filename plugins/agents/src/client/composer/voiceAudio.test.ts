import { describe, expect, it } from 'vitest'
import { encodeWav, insertDictation, releaseEnds, SPEECH_SAMPLE_RATE, trimSilence } from './voiceAudio'

describe('encodeWav', () => {
  it('writes a 16 kHz mono 16-bit header and clamps each sample', () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1, 2]))
    const view = new DataView(bytes.buffer)
    const text = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4))
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect(view.getUint32(4, true)).toBe(36 + 8)
    expect([view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)]).toEqual([
      1,
      SPEECH_SAMPLE_RATE,
      16,
    ])
    expect(view.getUint32(40, true)).toBe(8)
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767])
  })
})

describe('trimSilence', () => {
  const rate = 1_000
  const clip = (quietBefore: number, loud: number, quietAfter: number) =>
    new Float32Array([...Array(quietBefore).fill(0), ...Array(loud).fill(0.5), ...Array(quietAfter).fill(0)])

  it('keeps the speech and a little either side of it', () => {
    const trimmed = trimSilence(clip(500, 200, 500), rate, 0.01, 100)
    expect(trimmed.length).toBe(400)
    expect(trimmed[100]).toBe(0.5)
  })

  it('gives nothing back for a silent recording', () => {
    expect(trimSilence(new Float32Array(1_000), rate).length).toBe(0)
  })
})

describe('insertDictation', () => {
  it('spaces the words from text on either side and leaves the cursor after them', () => {
    expect(insertDictation('fix thebug', 7, ' the ')).toEqual({ text: 'fix the the bug', cursor: 11 })
    expect(insertDictation('fix ', 4, 'it')).toEqual({ text: 'fix it', cursor: 6 })
    expect(insertDictation('', 0, 'hello')).toEqual({ text: 'hello', cursor: 5 })
    expect(insertDictation('a\nb', 2, 'x')).toEqual({ text: 'a\nx b', cursor: 3 })
  })

  it('changes nothing when nothing was heard', () => {
    expect(insertDictation('draft', 2, '  ')).toEqual({ text: 'draft', cursor: 2 })
  })
})

it('tells a tap from a hold at 300 ms', () => {
  expect([releaseEnds(120), releaseEnds(299), releaseEnds(300), releaseEnds(2_000)]).toEqual([false, false, true, true])
})
