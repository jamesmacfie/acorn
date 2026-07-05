import { createRoot } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import type { PullFile } from '../../queries'
import { createDiffHydrator } from './hydration'
import type { ParsedFile, TokenizeLine } from './model'

const pullFile = (path: string, patch: string | null): PullFile => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 1,
  sha: `sha-${path}`,
  viewed: false,
  patch,
})

const plain: TokenizeLine = (_path, content) => [{ content, light: '', dark: '' }]

const waitFor = async (assertion: () => void) => {
  let last: unknown
  for (let i = 0; i < 20; i++) {
    try {
      assertion()
      return
    } catch (error) {
      last = error
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  throw last
}

type HydratorOptions = Parameters<typeof createDiffHydrator>[0]

const makeHydrator = (parsed: ParsedFile[], overrides: Partial<HydratorOptions> = {}) => {
  let disposeRoot!: () => void
  const hydrator = createRoot((dispose) => {
    disposeRoot = dispose
    return createDiffHydrator({
      tokenizerForFile: async () => plain,
      parseFile: (file) => ({ file, diff: [] }),
      onParsed: (file) => parsed.push(file),
      ...overrides,
    })
  })
  return { hydrator, disposeRoot }
}

describe('diff hydrator', () => {
  it('batch-fetches missing patches via fetchPatches and parses the prioritized file first', async () => {
    const fetchPatches = vi.fn(async (paths: string[]) => paths.map((path) => pullFile(path, `@@ ${path}`)))
    const parsed: ParsedFile[] = []
    const { hydrator, disposeRoot } = makeHydrator(parsed, { fetchPatches })

    try {
      hydrator.reset([pullFile('src/a.ts', null), pullFile('src/b.ts', null)], 'src/b.ts')

      await waitFor(() => {
        expect(parsed.map((file) => file.file.path)).toEqual(['src/b.ts', 'src/a.ts'])
      })
      expect(fetchPatches).toHaveBeenCalledTimes(1)
      expect(fetchPatches).toHaveBeenCalledWith(['src/b.ts', 'src/a.ts'], expect.any(AbortSignal))
      expect(hydrator.status('src/a.ts')).toBe('loaded')
      expect(hydrator.status('src/b.ts')).toBe('loaded')
    } finally {
      hydrator.dispose()
      disposeRoot()
    }
  })

  it('parses already-loaded patch-bearing files without fetching patch batches', async () => {
    const fetchPatches = vi.fn(async () => [] as PullFile[])
    const parsed: ParsedFile[] = []
    const { hydrator, disposeRoot } = makeHydrator(parsed, { fetchPatches })

    try {
      hydrator.reset([pullFile('src/a.ts', '@@ a'), pullFile('src/b.ts', '@@ b')], 'src/b.ts')

      await waitFor(() => {
        expect(parsed.map((file) => file.file.path)).toEqual(['src/b.ts', 'src/a.ts'])
      })
      expect(fetchPatches).not.toHaveBeenCalled()
      expect(hydrator.status('src/a.ts')).toBe('loaded')
      expect(hydrator.status('src/b.ts')).toBe('loaded')
    } finally {
      hydrator.dispose()
      disposeRoot()
    }
  })

  it('resolves patch-less files through cachedFile without needing fetchPatches', async () => {
    // The compare-preview wiring: every body is inline, so cachedFile serves even null-patch
    // (binary) files and no fetchPatches is provided.
    const binary = pullFile('img.png', null)
    const parsed: ParsedFile[] = []
    const { hydrator, disposeRoot } = makeHydrator(parsed, { cachedFile: (path) => (path === 'img.png' ? binary : null) })

    try {
      hydrator.reset([binary])
      await waitFor(() => {
        expect(parsed.map((file) => file.file.path)).toEqual(['img.png'])
      })
      expect(hydrator.status('img.png')).toBe('loaded')
    } finally {
      hydrator.dispose()
      disposeRoot()
    }
  })

  it('marks files with no resolvable body as errors when fetchPatches is omitted', async () => {
    const parsed: ParsedFile[] = []
    const { hydrator, disposeRoot } = makeHydrator(parsed)

    try {
      hydrator.reset([pullFile('src/a.ts', null)])
      await waitFor(() => {
        expect(hydrator.status('src/a.ts')).toBe('error')
      })
      expect(parsed).toEqual([])
    } finally {
      hydrator.dispose()
      disposeRoot()
    }
  })
})
