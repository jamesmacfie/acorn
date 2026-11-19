import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import {
  SPEECH_AUDIO_MAX_BYTES,
  type SpeechStatusResponse,
  type SpeechTranscribeResponse,
} from '@acorn/protocol/api.ts'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import { dispatchPluginRoute } from '../pluginHost/dispatch'
import { activeSpeechEngine } from '../pluginHost/speechEngines'

// Dictation in the agent composer (docs/agent-tools/speech-engines.md). The device records, and these
// handlers give the audio to the active engine plugin. server/index.ts loads them on first use. Neither the audio nor the text is logged, audited,
// or kept: the dispatch span records only the route, the status, and the time taken.

const STATUS_TIMEOUT_MS = 5_000
const TRANSCRIBE_TIMEOUT_MS = 30_000
const TEXT_MAX_BYTES = 64 * 1024
const SPEECH_TOO_LARGE = 'The recording is longer than 5 minutes.'

const statusSchema = z.object({
  state: z.enum(['ready', 'needs-setup', 'preparing', 'failed']),
  detail: z.string().max(300).optional(),
})
const transcriptSchema = z.object({ text: z.string() })

/** Runs before `transcribeSpeech`, with room for the multipart envelope around the audio. */
export const limitSpeechUpload = bodyLimit({
  maxSize: SPEECH_AUDIO_MAX_BYTES + 16 * 1024,
  onError: (c) => respondError(c, 413, 'bad_request', [SPEECH_TOO_LARGE]),
})

/** The plugin's own error message, if it sent the usual envelope, cut to one short line. */
async function engineMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } }
    return typeof body.error?.message === 'string' ? body.error.message.slice(0, 300) : undefined
  } catch {
    return undefined
  }
}

export async function readSpeechStatus(c: Context<AppEnv>): Promise<Response> {
  const engine = activeSpeechEngine()
  if (!engine) return c.json({ engine: null } satisfies SpeechStatusResponse)
  const named = {
    pluginId: engine.pluginId,
    id: engine.id,
    label: engine.label,
    ...(engine.settings ? { settings: engine.settings } : {}),
  }
  try {
    const response = await dispatchPluginRoute(
      c.env,
      engine.pluginId,
      engine.status,
      { method: 'GET' },
      AbortSignal.timeout(STATUS_TIMEOUT_MS),
    )
    const status = response.ok ? statusSchema.safeParse(await response.json()) : undefined
    if (status?.success) return c.json({ engine: { ...named, ...status.data } } satisfies SpeechStatusResponse)
    return c.json({
      engine: { ...named, state: 'failed', detail: `${engine.label} gave an answer Acorn can't read.` },
    } satisfies SpeechStatusResponse)
  } catch {
    return c.json({
      engine: { ...named, state: 'failed', detail: `${engine.label} didn't answer.` },
    } satisfies SpeechStatusResponse)
  }
}

export async function transcribeSpeech(c: Context<AppEnv>): Promise<Response> {
  const engine = activeSpeechEngine()
  if (!engine) return respondError(c, 404, 'not_found', ['No speech engine is installed on this Node.'])
  let audio: Uint8Array<ArrayBuffer>
  try {
    const file = (await c.req.formData()).get('audio')
    if (!(file instanceof File)) return respondError(c, 400, 'bad_request', ['Send the recording as `audio`.'])
    if (file.size > SPEECH_AUDIO_MAX_BYTES) return respondError(c, 413, 'bad_request', [SPEECH_TOO_LARGE])
    audio = new Uint8Array(await file.arrayBuffer())
  } catch {
    return respondError(c, 400, 'bad_request', ["Acorn couldn't read the recording."])
  }
  const signal = AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)
  const timedOut = () =>
    respondError(c, 504, 'timeout', [`${engine.label} didn't answer in ${TRANSCRIBE_TIMEOUT_MS / 1000} s.`])
  try {
    // Never retried: a second pass would double the wait on an engine that is already struggling.
    const response = await dispatchPluginRoute(
      c.env,
      engine.pluginId,
      engine.transcribe,
      { method: 'POST', body: audio, contentType: 'audio/wav' },
      signal,
    )
    if (!response.ok)
      return respondError(c, 502, 'provider_error', [
        (await engineMessage(response)) ?? `${engine.label} couldn't turn the recording into text.`,
      ])
    const body = await response.text()
    const parsed = Buffer.byteLength(body) <= TEXT_MAX_BYTES ? transcriptSchema.safeParse(JSON.parse(body)) : null
    if (!parsed?.success)
      return respondError(c, 502, 'provider_error', [`${engine.label} gave an answer Acorn can't read.`])
    return c.json({ text: parsed.data.text } satisfies SpeechTranscribeResponse)
  } catch {
    if (signal.aborted) return timedOut()
    return respondError(c, 502, 'provider_error', [`${engine.label} couldn't turn the recording into text.`])
  }
}
