import { createRoot } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import type { DiffFile } from './diffModel'
import { createDiffHydrator } from './hydration'
import type { ParsedFile } from './diffModel'

const pullFile = (path: string, patch: string | null): DiffFile => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 1,
  sha: `sha-${path}`,
  viewed: false,
  patch,
})

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
    const fetchPatches = vi.fn(async () => [] as DiffFile[])
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

  it('publishes the first priority file immediately and groups the rest by fetch batch', async () => {
    const publications: string[][] = []
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((path) => pullFile(path, `@@ ${path}`))
    const { hydrator, disposeRoot } = makeHydrator([], {
      onParsedBatch: (batch) => publications.push(batch.map((file) => file.file.path)),
    })

    try {
      hydrator.reset(files, 'b.ts')
      await waitFor(() => expect(publications).toHaveLength(3))

      expect(publications).toEqual([
        ['b.ts'],
        ['a.ts', 'c.ts', 'd.ts'],
        ['e.ts'],
      ])
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

  it('refresh reads only the paths it names, and keeps the rest', async () => {
    const fetchPatches = vi.fn(async (paths: string[]) => paths.map((path) => pullFile(path, `@@ ${path}`)))
    const parsed: ParsedFile[] = []
    const { hydrator, disposeRoot } = makeHydrator(parsed, { fetchPatches })

    try {
      const files = [pullFile('a.ts', null), pullFile('b.ts', null), pullFile('c.ts', null)]
      hydrator.reset(files)
      await waitFor(() => expect(parsed).toHaveLength(3))

      hydrator.refresh(files, ['b.ts'])
      await waitFor(() => expect(parsed).toHaveLength(4))
      expect(fetchPatches.mock.calls.at(-1)?.[0]).toEqual(['b.ts'])
      expect(parsed.at(-1)?.file.path).toBe('b.ts')
      expect(['a.ts', 'b.ts', 'c.ts'].map((path) => hydrator.status(path))).toEqual(['loaded', 'loaded', 'loaded'])

      hydrator.refresh(files, [])
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(fetchPatches).toHaveBeenCalledTimes(2)
    } finally {
      hydrator.dispose()
      disposeRoot()
    }
  })

  // The load already under way read the file before it changed. Letting it land would put the old
  // content on screen, and marking it loaded would drop the read that has the new content.
  it('refresh supersedes a load of the same path that is still in flight', async () => {
    let body = 'old'
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchPatches = vi.fn(async (paths: string[]) => {
      const seen = body
      if (seen === 'old') await gate
      return paths.map((path) => pullFile(path, `@@ ${seen}`))
    })
    const parsed: ParsedFile[] = []
    const { hydrator, disposeRoot } = makeHydrator(parsed, { fetchPatches })

    try {
      const files = [pullFile('a.ts', null)]
      hydrator.reset(files)
      await waitFor(() => expect(fetchPatches).toHaveBeenCalledTimes(1))

      body = 'new'
      hydrator.refresh(files, ['a.ts'])
      release()
      await waitFor(() => expect(parsed).toHaveLength(1))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(parsed.map((file) => file.file.patch)).toEqual(['@@ new'])
      expect(hydrator.status('a.ts')).toBe('loaded')
    } finally {
      hydrator.dispose()
      disposeRoot()
    }
  })
})
