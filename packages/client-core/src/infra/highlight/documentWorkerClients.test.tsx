import { afterEach, expect, it, vi } from 'vitest'
import { tokenizeDocument, resetHighlightWorker } from './worker'
import { diffWordsDocument, resetWordDiffWorker } from './wordDiffWorker'
import { wordDiffBatch } from '../../kit/diff/wordDiff'
const fallback = vi.hoisted(() => ({ syntax: vi.fn((text: string) => [[{ content: text, variants: { light: { color: 'black' }, dark: { color: 'white' } } }]]) }))
vi.mock('./shiki', () => ({ getHighlighter: async () => ({ codeToTokensWithThemes: fallback.syntax }) }))
vi.mock('../../kit/diff/wordDiff', async (original) => {
  const module = await original<typeof import('../../kit/diff/wordDiff')>()
  return { ...module, wordDiffBatch: vi.fn(module.wordDiffBatch) }
})
class FixtureWorker {
  static instances: FixtureWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  messages: { id: number; code?: string }[] = []
  constructor(_url: unknown) { FixtureWorker.instances.push(this) }
  postMessage(message: { id: number; code?: string }) { this.messages.push(message) }
  terminate() { this.terminated = true }
}
afterEach(() => { resetHighlightWorker(); resetWordDiffWorker(); vi.unstubAllGlobals(); vi.useRealTimers()
  FixtureWorker.instances = []; fallback.syntax.mockClear(); vi.mocked(wordDiffBatch).mockClear() })
it.each(['deadline', 'reset'] as const)('preserves exact Unicode multiline source and omits word marks after %s without renderer replay', async (cause) => {
  vi.stubGlobal('Worker', FixtureWorker); vi.useFakeTimers()
  const code = 'const café = "😀"\n\n/* 日本語 */\n'
  const syntax = tokenizeDocument('fixture.ts', code), words = diffWordsDocument([{ oldText: 'old café 😀', newText: 'new 日本語' }])
  await vi.waitFor(() => expect(FixtureWorker.instances).toHaveLength(2))
  if (cause === 'deadline') await vi.advanceTimersByTimeAsync(10_000)
  else { resetHighlightWorker(); resetWordDiffWorker() }
  const lines = await syntax
  expect(lines.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(code)
  expect(lines.flat().every((token) => token.light === '' && token.dark === '')).toBe(true)
  expect(await words).toEqual([])
  expect(fallback.syntax).not.toHaveBeenCalled(); expect(wordDiffBatch).not.toHaveBeenCalled()
  expect(FixtureWorker.instances.every((worker) => worker.terminated)).toBe(true); expect(vi.getTimerCount()).toBe(0)
  if (cause === 'deadline') {
    const posts = FixtureWorker.instances.map((worker) => worker.messages.length)
    await tokenizeDocument('fixture.ts', code); await diffWordsDocument([{ oldText: 'a', newText: 'b' }])
    expect(FixtureWorker.instances.map((worker) => worker.messages.length)).toEqual(posts)
    expect(fallback.syntax).not.toHaveBeenCalled(); expect(wordDiffBatch).not.toHaveBeenCalled()
  }
})
it('keeps ordinary per-document grammar fallback and a healthy shared syntax worker', async () => {
  vi.stubGlobal('Worker', FixtureWorker)
  const first = tokenizeDocument('fixture.ts', 'first')
  await vi.waitFor(() => expect(FixtureWorker.instances[0]?.messages).toHaveLength(1))
  const worker = FixtureWorker.instances[0]
  worker.onmessage!({ data: { id: worker.messages[0].id, ok: false } } as MessageEvent)
  expect((await first)[0][0].light).toBe('black'); expect(fallback.syntax).toHaveBeenCalledTimes(1)
  const second = tokenizeDocument('fixture.ts', 'second')
  await vi.waitFor(() => expect(worker.messages).toHaveLength(2))
  worker.onmessage!({ data: { id: worker.messages[1].id, ok: true, lines: [[{ content: 'second', light: 'worker-light', dark: 'worker-dark' }]] } } as MessageEvent)
  expect((await second)[0][0]).toMatchObject({ content: 'second', light: 'worker-light', dark: 'worker-dark' })
  expect(FixtureWorker.instances).toHaveLength(1); expect(worker.terminated).toBe(false)
})
