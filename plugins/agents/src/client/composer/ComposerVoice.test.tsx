import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { readJson } from '@acorn/plugin-api/client'
import { openMicrophone } from './voiceRecorder'
import { createComposerVoice } from './ComposerVoice'

vi.mock('./voiceRecorder', () => ({ openMicrophone: vi.fn(), microphoneProblem: () => 'The microphone is off.' }))
vi.mock('@acorn/plugin-api/client', () => ({
  readJson: vi.fn(),
  sendForm: vi.fn(),
  createLogger: () => ({ info: () => {}, warn: () => {} }),
  clientEvents: { emit: vi.fn() },
  formatChord: (chord: string) => chord,
  registerCommands: () => ({ dispose: () => {} }),
  registerKeybindings: () => ({ dispose: () => {} }),
}))

const engine = (state: string) => ({
  engine: { pluginId: 'voice', id: 'local', label: 'On-device speech', state },
})
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let dispose = () => {}
afterEach(() => {
  dispose()
  document.body.replaceChildren()
  vi.clearAllMocks()
})

it('counts up from zero and moves the meter while an engine finishes loading', async () => {
  let onLevel: (value: number) => void = () => {}
  vi.mocked(openMicrophone).mockImplementation(async (listener) => {
    onLevel = listener
    return { firstSampleAt: () => 0, stop: async () => new Float32Array(0), cancel: () => {} }
  })
  vi.mocked(readJson).mockResolvedValueOnce(engine('preparing')).mockResolvedValue(engine('ready'))
  const host = document.createElement('div')
  document.body.append(host)
  let toggle = () => {}
  dispose = render(() => {
    const voice = createComposerVoice({ nodeId: () => null, owns: () => false, begin: () => () => {} })
    return (
      <>
        {voice.button()}
        {voice.pill()}
      </>
    )
  }, host)
  await wait(10)
  toggle = () => (host.querySelector('button[aria-label="Dictate"]') as HTMLButtonElement).click()
  toggle()
  await wait(20)
  expect(host.textContent).toContain('Starting the microphone 0:00')
  onLevel(0.05)
  await wait(20)
  expect(host.textContent).toContain('Listening, loading the speech model 0:00')
  await wait(700)
  expect(host.textContent).toContain('Listening 0:00')
  expect(host.textContent).not.toContain('-1')
  onLevel(0.1)
  await wait(20)
  expect(host.querySelector('.ui-meter-fill')?.getAttribute('style')).toContain('0.8')
})
