import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SPEECH_AUDIO_MAX_BYTES } from '@acorn/protocol/api.ts'
import type { AppEnv, Principal } from '../middleware/auth'
import { requireDevice } from '../middleware/requireUser'
import { requestIdMiddleware } from '../respond'
import type { Env } from '../bindings'
import { dispatchPluginRoute } from '../pluginHost/dispatch'
import { declareSpeechEngines } from '../pluginHost/speechEngines'
import { readSpeechStatus, transcribeSpeech } from './speech'

vi.mock('../pluginHost/dispatch', () => ({ dispatchPluginRoute: vi.fn() }))
const dispatch = vi.mocked(dispatchPluginRoute)

const DEVICE: Principal = { kind: 'device', userId: 'u1', deviceId: 'd1' }
const AGENT: Principal = { kind: 'internal', userId: 'u1', scope: 'task', taskId: 't1' }
const ENGINE = {
  id: 'local',
  label: 'On-device speech',
  transcribe: '/v1/p/voice/transcribe',
  status: '/v1/p/voice/status',
  settings: 'voice-settings',
}

const call = (path: string, init: RequestInit = {}, principal = DEVICE) =>
  new Hono<AppEnv>()
    .use('*', requestIdMiddleware)
    .use('*', async (c, next) => {
      c.set('principal', principal)
      await next()
    })
    .use('/v1/core/speech/*', requireDevice)
    .get('/v1/core/speech/status', readSpeechStatus)
    .post('/v1/core/speech/transcribe', transcribeSpeech)
    .fetch(new Request(`http://acorn.test/v1/core/speech${path}`, init), {} as Env)

const recording = (bytes: number) => {
  const form = new FormData()
  form.append('audio', new File([new Uint8Array(bytes)], 'dictation.wav', { type: 'audio/wav' }))
  return { method: 'POST', body: form }
}

let undo = () => {}
afterEach(() => {
  undo()
  dispatch.mockReset()
})

describe('speech routes', () => {
  it('names no engine until a plugin declares one, and none again once it is gone', async () => {
    expect(await (await call('/status')).json()).toEqual({ engine: null })
    undo = declareSpeechEngines('voice', [ENGINE])
    dispatch.mockResolvedValue(Response.json({ state: 'needs-setup', detail: 'Download a model first.' }))
    expect(await (await call('/status')).json()).toEqual({
      engine: {
        pluginId: 'voice',
        id: 'local',
        label: 'On-device speech',
        settings: 'voice-settings',
        state: 'needs-setup',
        detail: 'Download a model first.',
      },
    })
    expect(dispatch.mock.calls[0]!.slice(1, 4)).toEqual(['voice', ENGINE.status, { method: 'GET' }])
    undo()
    expect(await (await call('/status')).json()).toEqual({ engine: null })
  })

  it('posts the recording to the engine as WAV and answers its text', async () => {
    undo = declareSpeechEngines('voice', [ENGINE])
    dispatch.mockResolvedValue(Response.json({ text: 'hello' }))
    const response = await call('/transcribe', recording(3200))
    expect(await response.json()).toEqual({ text: 'hello' })
    const [, pluginId, path, init] = dispatch.mock.calls[0]!
    expect([pluginId, path, init.contentType, (init.body as Uint8Array).byteLength]).toEqual([
      'voice',
      ENGINE.transcribe,
      'audio/wav',
      3200,
    ])
  })

  it('refuses a recording over the limit before any plugin sees it', async () => {
    undo = declareSpeechEngines('voice', [ENGINE])
    const response = await call('/transcribe', recording(SPEECH_AUDIO_MAX_BYTES + 1))
    expect(response.status).toBe(413)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("passes on the engine's own error message", async () => {
    undo = declareSpeechEngines('voice', [ENGINE])
    dispatch.mockResolvedValue(Response.json({ error: { message: 'Download a model first.' } }, { status: 409 }))
    const response = await call('/transcribe', recording(100))
    expect(response.status).toBe(502)
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe('Download a model first.')
  })

  it('sends audio to no engine when two plugins offer one', async () => {
    undo = declareSpeechEngines('voice', [ENGINE])
    const other = declareSpeechEngines('aaa', [
      { ...ENGINE, transcribe: '/v1/p/aaa/transcribe', status: '/v1/p/aaa/status' },
    ])
    try {
      const status = (await (await call('/status')).json()) as { engine: { state: string; detail: string } }
      expect(status.engine.state).toBe('failed')
      expect(status.engine.detail).toContain('aaa, voice')
      expect((await call('/transcribe', recording(100))).status).toBe(409)
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      other()
    }
  })

  it('refuses an agent', async () => {
    undo = declareSpeechEngines('voice', [ENGINE])
    expect((await call('/transcribe', recording(100), AGENT)).status).toBe(403)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
