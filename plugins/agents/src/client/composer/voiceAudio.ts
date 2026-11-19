// The parts of dictation that are plain arithmetic: the WAV the speech engine reads, trimming the
// silence around speech, where the words land in the draft, and telling a tap from a hold
// (docs/managed-agents/composer.md § Voice input).

/** The format every speech engine receives: 16 kHz, mono, 16-bit PCM (docs/agent-tools/speech-engines.md). */
export const SPEECH_SAMPLE_RATE = 16_000
/** A press shorter than this is a tap, which leaves the mic on until the next press. */
const TAP_MS = 300
/** The Node refuses more than about this much audio, so recording stops here. */
export const MAX_RECORDING_MS = 5 * 60_000

/** Samples in -1..1 as a 16-bit mono WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = SPEECH_SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per frame
  view.setUint16(34, 16, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  })
  return bytes
}

/** Root mean square of a block, for the level meter and the silence trim. */
export function level(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!
  return to > from ? Math.sqrt(sum / (to - from)) : 0
}

/** Cut the quiet before the first and after the last 20 ms window louder than `threshold`, keeping
 *  `padMs` either side so a soft first or last sound survives. All quiet gives an empty array. */
export function trimSilence(
  samples: Float32Array,
  sampleRate = SPEECH_SAMPLE_RATE,
  threshold = 0.01,
  padMs = 150,
): Float32Array {
  const window = Math.max(1, Math.round(sampleRate / 50))
  let first = -1
  let last = -1
  for (let start = 0; start < samples.length; start += window) {
    if (level(samples, start, Math.min(samples.length, start + window)) < threshold) continue
    if (first < 0) first = start
    last = Math.min(samples.length, start + window)
  }
  if (first < 0) return new Float32Array(0)
  const pad = Math.round((sampleRate * padMs) / 1000)
  return samples.subarray(Math.max(0, first - pad), Math.min(samples.length, last + pad))
}

/** Put dictated words in at `caret`, with a space on either side where the draft needs one. The
 *  cursor goes straight after the words. */
export function insertDictation(draft: string, caret: number, dictated: string): { text: string; cursor: number } {
  const words = dictated.trim()
  const at = Math.max(0, Math.min(caret, draft.length))
  if (!words) return { text: draft, cursor: at }
  const before = draft.slice(0, at)
  const after = draft.slice(at)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^\s/.test(after) ? ' ' : ''
  return { text: `${before}${lead}${words}${trail}${after}`, cursor: before.length + lead.length + words.length }
}

/** A short press leaves the mic on, hands-free, until the next press. A longer one was a hold, and
 *  letting go ends it. */
export const releaseEnds = (heldMs: number): boolean => heldMs >= TAP_MS
