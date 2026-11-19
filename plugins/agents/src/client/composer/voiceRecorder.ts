import { level, SPEECH_SAMPLE_RATE } from './voiceAudio'

// The microphone, open for one dictation. Only the app's own renderer may open it: the shell refuses
// every other webview, and a plugin frame has no `allow="microphone"` (docs/shell/origins.md § Microphone).

export type Recording = {
  /** When the first block of sound arrived, for the latency line. */
  firstSampleAt(): number | undefined
  /** Close the mic and give back what it heard, as 16 kHz mono. */
  stop(): Promise<Float32Array>
  /** Close the mic and throw the sound away. */
  cancel(): void
}

/** How the mic stood when it stopped delivering sound, for the log. Never any audio. */
type MicrophoneState = { context: string; track: string; muted: boolean; quietMs: number }

/** No blocks for this long means sound has stopped arriving, as distinct from someone being quiet:
 *  a silent room still delivers blocks. The first half tries to wake the audio, the rest gives up. */
const WAKE_AFTER_MS = 2_000
const GIVE_UP_AFTER_MS = 4_000
/** A real mic always picks up some noise, so this long of exact zeros means a device that sends
 *  nothing, such as a virtual one whose app isn't running. */
const DEAD_DEVICE_AFTER_MS = 1_500

export async function openMicrophone(
  onLevel: (value: number) => void,
  onLost: (reason: string, state: MicrophoneState) => void = () => {},
): Promise<Recording> {
  // Made before the mic is asked for, while the key press that started this still counts as the
  // person's own action, and resumed alongside the request rather than after it.
  const context = new AudioContext()
  const resumed = context.resume()
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
    await resumed
  } catch (error) {
    void context.close()
    throw error
  }
  const track = stream.getAudioTracks()[0]
  const source = context.createMediaStreamSource(stream)
  // shortcut: ScriptProcessorNode is deprecated. Move to an AudioWorklet if a WebView drops it; it
  // runs on the main thread, which is fine for one 4096-sample block every quarter second.
  const processor = context.createScriptProcessor(4096, 1, 1)
  const blocks: Float32Array[] = []
  let firstSampleAt: number | undefined
  const openedAt = performance.now()
  let lastBlockAt = openedAt
  let heardAnything = false
  processor.onaudioprocess = (event) => {
    lastBlockAt = performance.now()
    firstSampleAt ??= lastBlockAt
    const block = new Float32Array(event.inputBuffer.getChannelData(0))
    blocks.push(block)
    heardAnything ||= block.some((sample) => sample !== 0)
    onLevel(level(block))
  }
  source.connect(processor)
  // Unconnected, the processor never runs. It writes nothing to its output, so nothing is heard.
  processor.connect(context.destination)
  let closed = false
  // Said once, then the caller stops the recording, which closes all of this.
  const lose = (reason: string) => {
    if (closed) return
    clearInterval(watchdog)
    onLost(reason, {
      context: context.state,
      track: track?.readyState ?? 'none',
      muted: track?.muted ?? false,
      quietMs: Math.round(performance.now() - lastBlockAt),
    })
  }
  const watchdog = setInterval(() => {
    const quiet = performance.now() - lastBlockAt
    if (quiet > WAKE_AFTER_MS && context.state !== 'running') void context.resume().catch(() => {})
    if (quiet > GIVE_UP_AFTER_MS)
      lose('No sound reached Acorn from the microphone for 4 seconds, so recording stopped.')
    else if (!heardAnything && firstSampleAt !== undefined && performance.now() - openedAt > DEAD_DEVICE_AFTER_MS)
      lose(
        `${track?.label || 'The microphone'} is sending no sound. Choose another input in System Settings, under Sound.`,
      )
  }, 500)
  track?.addEventListener('ended', () => lose('The microphone was turned off or unplugged, so recording stopped.'))
  const close = () => {
    if (closed) return
    closed = true
    clearInterval(watchdog)
    processor.onaudioprocess = null
    processor.disconnect()
    source.disconnect()
    // Stopping the tracks is what turns the system's mic indicator off.
    for (const track of stream.getTracks()) track.stop()
    void context.close()
  }
  return {
    firstSampleAt: () => firstSampleAt,
    cancel: close,
    async stop() {
      const rate = context.sampleRate
      close()
      return toSpeechRate(blocks, rate)
    },
  }
}

async function toSpeechRate(blocks: readonly Float32Array[], rate: number): Promise<Float32Array> {
  const length = blocks.reduce((total, block) => total + block.length, 0)
  const joined = new Float32Array(length)
  let at = 0
  for (const block of blocks) {
    joined.set(block, at)
    at += block.length
  }
  if (!length || rate === SPEECH_SAMPLE_RATE) return joined
  const offline = new OfflineAudioContext(1, Math.ceil((length * SPEECH_SAMPLE_RATE) / rate), SPEECH_SAMPLE_RATE)
  const buffer = offline.createBuffer(1, length, rate)
  buffer.copyToChannel(joined, 0)
  const player = offline.createBufferSource()
  player.buffer = buffer
  player.connect(offline.destination)
  player.start()
  return (await offline.startRendering()).getChannelData(0)
}

/** What went wrong opening the mic, in words the person can act on. */
export function microphoneProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError')
    return 'The microphone is off for Acorn. Turn it on in System Settings, under Privacy & Security.'
  if (name === 'NotFoundError') return 'No microphone is connected.'
  return "Acorn couldn't open the microphone."
}
