import { createSignal, onCleanup } from 'solid-js'
import type { SpeechTranscribeResponse } from '@acorn/protocol/api.ts'
import { createLogger, sendForm } from '@acorn/plugin-api/client'
import { encodeWav, MAX_RECORDING_MS, releaseEnds, trimSilence } from './voiceAudio'
import { microphoneProblem, openMicrophone, type Recording } from './voiceRecorder'

// One composer's dictation: the mic is open only while `phase` is `recording`, and the pill draws
// from `phase` (docs/managed-agents/composer.md § Voice input). The words go to whatever `begin`
// returned when recording started, so a session switch mid-dictation still fills the draft it began in.

export type VoicePhase =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number; handsFree: boolean }
  | { kind: 'transcribing' }
  | { kind: 'message'; text: string }

type Deliver = (text: string) => void

// Timings only. The words never reach a log, because dictation is often private.
const log = createLogger('agents.voice', 'agents')

export function createVoiceInput(options: { nodeId: () => string | null; begin: () => Deliver }) {
  const [phase, setPhase] = createSignal<VoicePhase>({ kind: 'idle' })
  const [level, setLevel] = createSignal(0)
  // False until the first block of sound arrives: the mic can take a second or two to open.
  const [hearing, setHearing] = createSignal(false)
  let recording: Promise<Recording | undefined> | undefined
  let deliver: Deliver | undefined
  let pressedAt: number | undefined
  let capped: ReturnType<typeof setTimeout> | undefined
  let stopKeys: (() => void) | undefined
  // Bumped by a cancel, so a transcription still on its way is dropped rather than put in the draft.
  let runs = 0

  const start = (handsFree: boolean) => {
    const startedAt = performance.now()
    deliver = options.begin()
    setLevel(0)
    setHearing(false)
    setPhase({ kind: 'recording', startedAt, handsFree })
    capped = setTimeout(() => void stop('Recording stopped at 5 minutes.'), MAX_RECORDING_MS)
    const onLevel = (value: number) => {
      setHearing(true)
      setLevel(value)
    }
    recording = openMicrophone(onLevel, (reason, state) => {
      log.warn('the microphone stopped delivering sound', undefined, {
        'voice.context': state.context,
        'voice.track': state.track,
        'voice.muted': state.muted,
        'voice.quiet_ms': state.quietMs,
      })
      // Keep what was heard before it went quiet, and say why it ended.
      void stop(reason)
    }).catch((error: unknown) => {
      finish({ kind: 'message', text: microphoneProblem(error) })
      return undefined
    })
  }

  const finish = (next: VoicePhase) => {
    clearTimeout(capped)
    stopKeys?.()
    stopKeys = undefined
    pressedAt = undefined
    recording = undefined
    setPhase(next)
  }

  async function stop(note?: string) {
    const current = phase()
    if (current.kind !== 'recording' || !recording) return
    const releasedAt = performance.now()
    const open = recording
    const to = deliver
    const run = ++runs
    finish({ kind: 'transcribing' })
    const mic = await open
    if (!mic) return
    const firstSampleAt = mic.firstSampleAt()
    const speech = trimSilence(await mic.stop())
    if (run !== runs) return
    if (!speech.length) {
      setPhase(note ? { kind: 'message', text: note } : { kind: 'idle' })
      return
    }
    try {
      const { text } = await sendForm<SpeechTranscribeResponse>(
        '/v1/core/speech/transcribe',
        [{ name: 'audio', filename: 'dictation.wav', type: 'audio/wav', bytes: encodeWav(speech) }],
        "The speech engine couldn't turn that into text.",
        { nodeId: options.nodeId() },
      )
      if (run !== runs) return
      to?.(text)
      log.info('dictation', undefined, {
        'voice.press_to_first_sample_ms':
          firstSampleAt === undefined ? -1 : Math.round(firstSampleAt - current.startedAt),
        'voice.release_to_text_ms': Math.round(performance.now() - releasedAt),
        'voice.audio_ms': Math.round(speech.length / 16),
      })
      setPhase(note ? { kind: 'message', text: note } : { kind: 'idle' })
    } catch (error) {
      if (run !== runs) return
      setPhase({
        kind: 'message',
        text: error instanceof Error ? error.message : "The speech engine couldn't turn that into text.",
      })
    }
  }

  /** The shortcut went down. Key repeat calls this again while it is held, which changes nothing. */
  const press = () => {
    const current = phase()
    if (current.kind === 'recording') {
      if (current.handsFree && pressedAt === undefined) void stop()
      return
    }
    if (current.kind === 'transcribing') return
    pressedAt = performance.now()
    start(false)
    // Any key coming up ends the hold. On macOS, letting go of a key while Command is down sends no
    // keyup for it, so the modifier's own keyup is often the only one that arrives.
    const release = () => {
      stopKeys?.()
      stopKeys = undefined
      const held = pressedAt === undefined ? 0 : performance.now() - pressedAt
      pressedAt = undefined
      const now = phase()
      if (now.kind !== 'recording') return
      if (releaseEnds(held)) void stop()
      else setPhase({ ...now, handsFree: true })
    }
    window.addEventListener('keyup', release)
    window.addEventListener('blur', release)
    stopKeys = () => {
      window.removeEventListener('keyup', release)
      window.removeEventListener('blur', release)
    }
  }

  /** The mic button or the pill's stop. */
  const toggle = () => {
    const current = phase()
    if (current.kind === 'recording') void stop()
    else if (current.kind !== 'transcribing') start(true)
  }

  /** Escape or the pill's close button: the mic closes and the recording is thrown away, or a
   *  transcription on its way is dropped. Either way the draft is left exactly as it was. */
  const cancel = () => {
    const kind = phase().kind
    if (kind !== 'recording' && kind !== 'transcribing') return
    runs++
    const open = recording
    finish({ kind: 'idle' })
    void open?.then((mic) => mic?.cancel())
  }

  const dismiss = () => {
    if (phase().kind === 'message') setPhase({ kind: 'idle' })
  }

  onCleanup(() => {
    const open = recording
    finish({ kind: 'idle' })
    void open?.then((mic) => mic?.cancel())
  })

  return { phase, level, hearing, press, toggle, cancel, dismiss }
}
