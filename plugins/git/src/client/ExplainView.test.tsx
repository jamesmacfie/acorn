import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { ExplainResult } from '../shared/api'

const [node, setNode] = createSignal('node-a')
const [revision, setRevision] = createSignal('a'.repeat(40))
const writeJson = vi.fn<(...args: unknown[]) => Promise<ExplainResult>>()
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: readonly unknown[] }) => ({
    get data() { return options().queryKey[0] === 'model-backends'
      ? { backends: [{ id: 'harness:fixture', kind: 'harness', label: 'Fixture', models: [{ id: 'model', label: 'Model' }], defaultModelId: 'model' }] }
      : {} },
  }),
  useQueryClient: () => ({}),
}))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: node, nodeReady: () => true,
  modelBackendsOptions: () => ({ queryKey: ['model-backends'] }), prefsOptions: () => ({ queryKey: ['prefs'] }),
  readGeneratePick: () => null, saveGeneratePick: async () => true,
  effectiveModelPick: (backends: { id: string }[]) => backends[0] ? { backendId: backends[0].id, modelId: 'model' } : null,
  writeJson,
}))

const { ExplainView } = await import('./ExplainView')
let host: HTMLElement | null = null
let dispose = () => {}
afterEach(() => { dispose(); host?.remove(); host = null; setNode('node-a'); setRevision('a'.repeat(40)); writeJson.mockReset() })
const draw = () => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <ExplainView projectId="project" kind="commit" id={revision()} base={null} />, host)
}
const button = (label: string) => [...host!.querySelectorAll('button')].find((item) => item.textContent?.includes(label))!
const answer = (text: string): ExplainResult => ({ text, backendId: 'harness:fixture', modelId: 'model', omissions: [] })
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

it('starts only on press, cancels, retries, and discards a late response after revision or Node change', async () => {
  let settle!: (value: ExplainResult) => void
  writeJson.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
  draw()
  expect(writeJson).not.toHaveBeenCalled()
  button('Explain commit').click()
  await tick()
  expect(writeJson).toHaveBeenCalledTimes(1)
  const firstSignal = (writeJson.mock.calls[0]![1] as { signal: AbortSignal }).signal
  expect(host!.textContent).toContain('Generating explanation')
  button('Cancel generation').click()
  expect(firstSignal.aborted).toBe(true)
  settle(answer('too late'))
  await tick()
  expect(host!.textContent).not.toContain('too late')

  writeJson.mockResolvedValueOnce(answer('current revision'))
  button('Explain commit').click()
  await tick()
  expect(host!.textContent).toContain('current revision')
  setRevision('b'.repeat(40))
  await tick()
  expect(host!.textContent).not.toContain('current revision')

  writeJson.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
  button('Explain commit').click()
  await tick()
  const thirdSignal = (writeJson.mock.calls[2]![1] as { signal: AbortSignal }).signal
  setNode('node-b')
  await tick()
  expect(thirdSignal.aborted).toBe(true)
  settle(answer('wrong node'))
  await tick()
  expect(host!.textContent).not.toContain('wrong node')
})

it('shows a provider failure with a retry action, then replaces it with a successful answer', async () => {
  setRevision('c'.repeat(40))
  writeJson.mockRejectedValueOnce(Object.assign(new Error('provider_unavailable'), { code: 'provider_unavailable' }))
    .mockResolvedValueOnce(answer('Recovered explanation'))
  draw()
  button('Explain commit').click()
  await tick()
  expect(host!.textContent).toContain('Fixture')
  expect(button('Retry explanation')).toBeTruthy()
  button('Retry explanation').click()
  await tick()
  expect(host!.textContent).toContain('Recovered explanation')
})
