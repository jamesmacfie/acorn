import { describe, expect, it, vi } from 'vitest'
import type { PullFile } from '../../queries'
import { parseFilesInChunks } from './chunkedParse'
import { plainTokenize, type ParsedFile } from './model'

const file = (path: string): PullFile => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 1,
  sha: `sha-${path}`,
  viewed: false,
  patch: ['@@ -1,1 +1,1 @@', '-old', '+new'].join('\n'),
})

describe('chunked diff parsing', () => {
  const chunkPaths = (call: unknown[]) => (call[0] as ParsedFile[]).map((p) => p.file.path)

  it('publishes cumulative chunks and yields between them', async () => {
    const onChunk = vi.fn()
    const pause = vi.fn(async () => {})

    await expect(
      parseFilesInChunks([file('a.ts'), file('b.ts')], plainTokenize, {
        chunkSize: 1,
        onChunk,
        yieldToMain: pause,
      }),
    ).resolves.toBe(true)

    expect(onChunk).toHaveBeenCalledTimes(2)
    expect(chunkPaths(onChunk.mock.calls[0]!)).toEqual(['a.ts'])
    expect(chunkPaths(onChunk.mock.calls[1]!)).toEqual(['a.ts', 'b.ts'])
    expect(pause).toHaveBeenCalledTimes(2)
  })

  it('does not publish stale chunks after cancellation', async () => {
    const onChunk = vi.fn()

    await expect(
      parseFilesInChunks([file('a.ts')], plainTokenize, {
        isCancelled: () => true,
        onChunk,
      }),
    ).resolves.toBe(false)

    expect(onChunk).not.toHaveBeenCalled()
  })

  it('stops publishing additional chunks once a newer run wins', async () => {
    const onChunk = vi.fn()
    let cancelled = false

    await expect(
      parseFilesInChunks([file('a.ts'), file('b.ts')], plainTokenize, {
        chunkSize: 1,
        isCancelled: () => cancelled,
        onChunk,
        yieldToMain: async () => {
          cancelled = true
        },
      }),
    ).resolves.toBe(false)

    expect(onChunk).toHaveBeenCalledTimes(1)
    expect(chunkPaths(onChunk.mock.calls[0]!)).toEqual(['a.ts'])
  })
})
