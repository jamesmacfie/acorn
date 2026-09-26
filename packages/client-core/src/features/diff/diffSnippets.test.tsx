import { createRoot, createSignal } from 'solid-js'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, describe, expect, it } from 'vitest'
import { segmentContentKey, type DiffDocumentFile, type DiffSegmentPayload, type DiffSegmentRequest } from '@acorn/diff-document/document'
import { createDiffSnippets, type DiffSnippets } from './diffSnippets'
import { residentKey, segmentCacheFor } from './segmentCache'

// A review thread's quoted lines, read from the one segment that holds its line (./diffSnippets.ts).
// What is under test is what gets loaded: only the segments a card asked for, never a whole patch,
// and nothing at all for a file the document does not hold.

const segment = (newFirst: number, newLast: number) => ({ rows: 10, bands: 10, gaps: 0, columns: 20, lines: [newFirst, newLast, newFirst, newLast] as [number, number, number, number] })
const file = (path: string, patchKey: string | null): DiffDocumentFile => ({
  path, status: 'modified', additions: 1, deletions: 1, sha: `sha-${path}`, viewed: false, patchKey,
  segments: patchKey ? [segment(1, 10), segment(11, 20)] : [],
})
const files = [file('a.ts', 'sha256:aa'), file('b.ts', 'sha256:bb'), file('binary.png', null)]

const rowsFor = (request: DiffSegmentRequest) => {
  const first = request.ordinal * 10 + 1
  return Array.from({ length: 10 }, (_, index) => ({
    kind: 'normal' as const, oldNo: first + index, newNo: first + index, raw: `${request.path} line ${first + index}`,
  }))
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); dispose = undefined })

function setup(client = new QueryClient(), document: DiffDocumentFile[] | undefined = files) {
  const asked: DiffSegmentRequest[][] = []
  const [known, setKnown] = createSignal(document)
  let snippets!: DiffSnippets
  createRoot((done) => {
    dispose = done
    QueryClientProvider({
      client,
      get children() {
        snippets = createDiffSnippets({
          files: known,
          load: async (requests): Promise<DiffSegmentPayload[]> => {
            asked.push(requests)
            return requests.map((request) => ({ ...request, rows: rowsFor(request) }))
          },
        })
        return null
      },
    })
  })
  return { snippets, asked, client, setKnown }
}

describe('diff snippets', () => {
  it('reads only the segment holding a wanted line, and draws two lines either side', async () => {
    const { snippets, asked } = setup()
    const anchor = { path: 'a.ts', side: 'new' as const, line: 15 }
    expect(snippets.snippet(anchor)).toEqual({ state: 'loading' })
    snippets.want(anchor)
    await flush()
    expect(asked).toEqual([[{ path: 'a.ts', patchKey: 'sha256:aa', ordinal: 1 }]])
    const shown = snippets.snippet(anchor)
    expect(shown.state === 'ready' && shown.lines.map((line) => line.newNo)).toEqual([13, 14, 15, 16, 17])
  })

  it('loads nothing for a card that has not asked', async () => {
    const { snippets, asked } = setup()
    snippets.snippet({ path: 'b.ts', side: 'new', line: 3 })
    await flush()
    expect(asked).toEqual([])
  })

  it('says a snippet is unavailable, and loads nothing, for a file with no patch or no segment', async () => {
    const { snippets, asked } = setup()
    for (const anchor of [
      { path: 'binary.png', side: 'new' as const, line: 1 },
      { path: 'capped.ts', side: 'new' as const, line: 1 },
      { path: 'a.ts', side: 'new' as const, line: 400 },
    ]) {
      snippets.want(anchor)
      expect(snippets.snippet(anchor)).toEqual({ state: 'unavailable' })
    }
    await flush()
    expect(asked).toEqual([])
  })

  it('waits for the document before saying anything is unavailable', async () => {
    const { snippets, asked, setKnown } = setup(new QueryClient(), undefined)
    const anchor = { path: 'a.ts', side: 'new' as const, line: 2 }
    snippets.want(anchor)
    expect(snippets.snippet(anchor)).toEqual({ state: 'loading' })
    setKnown(files)
    await flush()
    expect(asked).toHaveLength(1)
    expect(snippets.snippet(anchor).state).toBe('ready')
  })

  it('shares rows with the diff viewer through the node cache, uncoloured', async () => {
    const client = new QueryClient()
    const first = setup(client)
    const anchor = { path: 'a.ts', side: 'new' as const, line: 2 }
    first.snippets.want(anchor)
    await flush()
    const key = residentKey(segmentContentKey('sha256:aa', 0), 'a.ts', 'sha-a.ts')
    // Left for the viewer to colour: a snippet never records plain rows as a segment's colour.
    expect(segmentCacheFor(client).peek(key)?.enriched).toBeFalsy()
    dispose?.()

    const second = setup(client)
    second.snippets.want(anchor)
    await flush()
    expect(second.asked).toEqual([])
    expect(second.snippets.snippet(anchor).state).toBe('ready')
  })
})
