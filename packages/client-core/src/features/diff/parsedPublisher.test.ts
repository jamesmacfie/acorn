import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffFile, ParsedFile } from '../../kit/diff/diffModel'
import { createParsedFilePublisher } from './parsedPublisher'

const parsed = (path: string): ParsedFile => ({
  file: {
    path,
    status: 'modified',
    additions: 1,
    deletions: 0,
    sha: path,
    viewed: false,
    patch: '@@',
  } satisfies DiffFile,
  diff: [],
})

afterEach(() => vi.useRealTimers())

describe('parsed file publication', () => {
  it('publishes priority files immediately and batches the rest into an idle turn', () => {
    vi.useFakeTimers()
    const publications: string[][] = []
    const publisher = createParsedFilePublisher({
      publish: (files) => publications.push(files.map((file) => file.file.path)),
      isPriority: (path) => path === 'visible.ts',
    })

    publisher.enqueue([parsed('visible.ts'), parsed('background-a.ts'), parsed('background-b.ts')])
    expect(publications).toEqual([['visible.ts']])

    vi.advanceTimersByTime(16)
    expect(publications).toEqual([['visible.ts'], ['background-a.ts', 'background-b.ts']])
    publisher.dispose()
  })

  it('holds background publications while scrolling but lets newly visible files through', () => {
    vi.useFakeTimers()
    const publications: string[][] = []
    const publisher = createParsedFilePublisher({
      publish: (files) => publications.push(files.map((file) => file.file.path)),
      isPriority: () => false,
    })

    publisher.markScrolling()
    publisher.enqueue([parsed('a.ts'), parsed('b.ts')])
    vi.advanceTimersByTime(100)
    expect(publications).toEqual([])

    publisher.flush(['b.ts'])
    expect(publications).toEqual([['b.ts']])

    vi.advanceTimersByTime(166)
    expect(publications).toEqual([['b.ts'], ['a.ts']])
    publisher.dispose()
  })

  it('drops queued files when the diff changes', () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    const publisher = createParsedFilePublisher({ publish, isPriority: () => false })

    publisher.enqueue([parsed('old.ts')])
    publisher.reset()
    vi.runAllTimers()

    expect(publish).not.toHaveBeenCalled()
  })
})
