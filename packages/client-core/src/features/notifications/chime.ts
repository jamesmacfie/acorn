// The sound channel: two short chimes, synthesised
// (docs/notifications.md § The channels).
//
// No audio file ships. Two sine notes and a gain envelope are twenty lines and have no format,
// player, or bundling question, and a chime that is data can be asserted without an `AudioContext`.
//
// Two chimes and not three. `blocked` and `error` both mean "come here"; `finished` means "it is
// yours again". A third tone is something to learn for a distinction the title already draws.
import { registerNoticeSink } from './deliver'
import { readNotificationSettings } from './settings'
import type { Notice } from './notifications'

export type Note = {
  frequencyHz: number
  startMs: number
  durationMs: number
  gain: number
}

export type ChimeName = 'attention' | 'done'

// Tuned by ear at a desk, quiet enough to sit under a conversation. `attention` rises a fourth,
// E5 → A5; `done` falls the same fourth back. Both land inside 320 ms, so a burst of edges reads as
// separate chimes rather than a chord.
export const CHIMES: Record<ChimeName, Note[]> = {
  attention: [
    { frequencyHz: 659.25, startMs: 0, durationMs: 140, gain: 0.12 },
    { frequencyHz: 880, startMs: 120, durationMs: 200, gain: 0.12 },
  ],
  done: [
    { frequencyHz: 880, startMs: 0, durationMs: 140, gain: 0.1 },
    { frequencyHz: 659.25, startMs: 120, durationMs: 200, gain: 0.1 },
  ],
}

// The slice of WebAudio a chime uses, written out rather than imported so a test can pass a fake and
// a host without the DOM lib still compiles. A real `AudioContext` satisfies it.
type ParamLike = {
  setValueAtTime(value: number, at: number): void
  linearRampToValueAtTime(value: number, at: number): void
}
export type AudioContextLike = {
  currentTime: number
  state?: string
  resume?(): Promise<void>
  destination: unknown
  createOscillator(): { frequency: ParamLike; connect(to: unknown): void; start(at: number): void; stop(at: number): void }
  createGain(): { gain: ParamLike; connect(to: unknown): void }
}

// A note that starts and stops at full gain clicks. 20 ms in, then down to silence at its end.
const ATTACK_S = 0.02

export function playChime(name: ChimeName, audio: AudioContextLike): void {
  const from = audio.currentTime
  for (const note of CHIMES[name]) {
    const at = from + note.startMs / 1000
    const until = at + note.durationMs / 1000
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.frequency.setValueAtTime(note.frequencyHz, at)
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(note.gain, at + ATTACK_S)
    gain.gain.linearRampToValueAtTime(0, until)
    osc.connect(gain)
    gain.connect(audio.destination)
    osc.start(at)
    osc.stop(until)
  }
}

// Built on the first chime, not at boot: a context made before anyone has clicked anything is born
// suspended by the autoplay policy, and one that exists costs an audio thread whether or not this
// app ever makes a sound. `resume` is asked for on every play and its refusal ignored, because
// outside a user gesture the browser says no and the next play — or the gesture below — asks again.
let context: AudioContextLike | null = null

function audio(): AudioContextLike | null {
  const Ctor = (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext
  if (!Ctor) return null
  context ??= new Ctor()
  if (context.state === 'suspended') void context.resume?.().catch(() => {})
  return context
}

/** Play a sound for every unseen notice the settings allow, and unwedge the audio context on the
 *  first click or keypress so the first chime after boot sounds rather than warming up in silence. */
export function initSoundNotices(): () => void {
  const unlock = () => { if (context?.state === 'suspended') void context.resume?.().catch(() => {}) }
  document.addEventListener('pointerdown', unlock)
  document.addEventListener('keydown', unlock)
  const drop = registerNoticeSink(soundSink)
  return () => {
    document.removeEventListener('pointerdown', unlock)
    document.removeEventListener('keydown', unlock)
    drop()
  }
}

/** Exported for the test. Sinks only ever see an unseen notice, so the seen rule is already kept. */
export function soundSink(notice: Notice): void {
  if (!readNotificationSettings().sound) return
  const ctx = audio()
  if (ctx) playChime(notice.kind === 'agent-completed' ? 'done' : 'attention', ctx)
}
