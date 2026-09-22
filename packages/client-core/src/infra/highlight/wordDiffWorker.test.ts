import { afterEach, expect, it, vi } from 'vitest'
import { diffWordsDocument, resetWordDiffWorker } from './wordDiffWorker'

afterEach(() => {
  resetWordDiffWorker()
  vi.unstubAllGlobals()
})

it('keeps a main-thread fallback when workers are unavailable', async () => {
  vi.stubGlobal('Worker', undefined)

  const [result] = await diffWordsDocument([{ oldText: 'const old = 1', newText: 'const next = 1' }])

  expect(result?.del.map((token) => token.content).join('')).toBe('const old = 1')
  expect(result?.add.map((token) => token.content).join('')).toBe('const next = 1')
  expect(result?.del.some((token) => token.kind === 'del')).toBe(true)
  expect(result?.add.some((token) => token.kind === 'add')).toBe(true)
})
