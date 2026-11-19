import { createRoot } from 'solid-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sendForm } from '@acorn/plugin-api/client'
import { openMicrophone } from './voiceRecorder'
import { createVoiceInput } from './dictation'

vi.mock('./voiceRecorder', () => ({ openMicrophone: vi.fn(), microphoneProblem: () => 'The microphone is off.' }))
vi.mock('@acorn/plugin-api/client', () => ({
  sendForm: vi.fn(),
  createLogger: () => ({ info: () => {}, warn: () => {} }),
}))

const speech = new Float32Array(1_600).fill(0.5)
let clock = 0
const closed = vi.fn()
let dispose = () => {}

beforeEach(() => {
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.mocked(openMicrophone).mockResolvedValue({
    firstSampleAt: () => 10,
    stop: async () => speech,
    cancel: closed,
  })
  vi.mocked(sendForm).mockResolvedValue({ text: 'hello' })
})
afterEach(() => {
  dispose()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const voice = () => {
  const heard: string[] = []
  const input = createRoot((done) => {
    dispose = done
    return createVoiceInput({ nodeId: () => null, begin: () => (text) => heard.push(text) })
  })
  return { input, heard }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const keyUpAt = (at: number) => {
  clock = at
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }))
}

it('stops when a held shortcut is let go and puts the words in', async () => {
  const { input, heard } = voice()
  input.press()
  input.press() // key repeat
  expect(input.phase().kind).toBe('recording')
  keyUpAt(800)
  await settle()
  expect(heard).toEqual(['hello'])
  expect(input.phase().kind).toBe('idle')
  expect(openMicrophone).toHaveBeenCalledTimes(1)
})

it('keeps listening after a tap, until the next press', async () => {
  const { input, heard } = voice()
  input.press()
  keyUpAt(120)
  expect(input.phase()).toMatchObject({ kind: 'recording', handsFree: true })
  input.press()
  await settle()
  expect(heard).toEqual(['hello'])
})

it('says why when the mic will not open, and sends nothing', async () => {
  vi.mocked(openMicrophone).mockRejectedValue(new DOMException('no', 'NotAllowedError'))
  const { input, heard } = voice()
  input.toggle()
  await settle()
  expect(input.phase()).toEqual({ kind: 'message', text: 'The microphone is off.' })
  expect(heard).toEqual([])
  expect(sendForm).not.toHaveBeenCalled()
})

it('throws the recording away on cancel and closes the mic', async () => {
  const { input, heard } = voice()
  input.toggle()
  await settle()
  input.cancel()
  await settle()
  expect(input.phase()).toEqual({ kind: 'idle' })
  expect(closed).toHaveBeenCalledTimes(1)
  expect(sendForm).not.toHaveBeenCalled()
  expect(heard).toEqual([])
})

it('drops a transcription cancelled on its way, leaving the draft alone', async () => {
  let answer: (value: { text: string }) => void = () => {}
  vi.mocked(sendForm).mockReturnValue(new Promise((resolve) => (answer = resolve)))
  const { input, heard } = voice()
  input.toggle()
  await settle()
  input.toggle()
  await settle()
  expect(input.phase().kind).toBe('transcribing')
  input.cancel()
  answer({ text: 'hello' })
  await settle()
  expect(heard).toEqual([])
  expect(input.phase()).toEqual({ kind: 'idle' })
})

it('stops and keeps what it heard when the mic stops delivering sound', async () => {
  let lose: (reason: string) => void = () => {}
  vi.mocked(openMicrophone).mockImplementation(async (_onLevel, onLost) => {
    lose = (reason) => onLost?.(reason, { context: 'suspended', track: 'live', muted: true, quietMs: 4_100 })
    return { firstSampleAt: () => 10, stop: async () => speech, cancel: closed }
  })
  const { input, heard } = voice()
  input.toggle()
  await settle()
  lose('No sound reached Acorn.')
  await settle()
  expect(heard).toEqual(['hello'])
  expect(input.phase()).toEqual({ kind: 'message', text: 'No sound reached Acorn.' })
})
