import { createRoot } from 'solid-js'
import { afterEach, expect, it, vi } from 'vitest'

// The Changes model's side of a revision conflict (./changesModel.tsx § conflicted): a segment asked
// for against a digest the node no longer describes reads the document again, once, and the viewer
// draws the new revision. The node's refusal is covered in ../server/routes/localGit.test.ts.

vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: undefined }), useQueryClient: () => ({}) }))
vi.mock('@acorn/plugin-api/ui/host', () => ({ registerKeybindings: () => ({ dispose() {} }) }))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...await original<Record<string, unknown>>(),
  isArchiving: () => false,
  taskStatusRevision: () => 0,
  registerCommands: () => ({ dispose() {} }),
  readJson: async () => [],
  clientEvents: { on: () => () => {}, emit: () => {} },
  projectsOptions: () => ({}),
  prefsOptions: () => ({}),
}))
const api = vi.hoisted(() => ({
  status: vi.fn(),
  document: vi.fn(),
  segments: vi.fn(),
  search: vi.fn(),
  modelBackends: vi.fn(async () => []),
  headCommit: vi.fn(async () => null),
}))
vi.mock('./changesClient', () => ({ localGitApi: api }))

const { createChangesModel } = await import('./changesModel')

const FIRST = `sha256:${'1'.repeat(64)}`
const SECOND = `sha256:${'2'.repeat(64)}`
const segment = { rows: 1, bands: 1, gaps: 0, columns: 1, lines: [1, 1, 1, 1] as [number, number, number, number] }
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const disposers: (() => void)[] = []
/** Document reads for the stacked file. The first read, before status answers, is of an empty stack. */
const reads = () => api.document.mock.calls.filter(([, request]) => request.files.length > 0).length
/** The node's document: each read of the stack answers the next digest in `digests`. */
const answering = (...digests: string[]) => {
  let at = 0
  api.document.mockImplementation(async (_task: string, request: { files: unknown[] }) => (request.files.length
    ? { files: [{ path: 'a.txt', patchKey: digests[Math.min(at++, digests.length - 1)], segments: [segment] }] }
    : { files: [] }))
}
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose())
  vi.clearAllMocks()
})

it('reads the document again after a revision conflict and draws the new revision, once', async () => {
  api.status.mockResolvedValue({
    branch: 'main', upstream: null, ahead: null, behind: null, operation: null,
    changes: [{ path: 'a.txt', status: 'modified', staged: false, additions: 1, deletions: 0, contentKey: 'k' }],
  })
  answering(FIRST, SECOND)
  api.segments.mockRejectedValue(Object.assign(new Error('changed'), { status: 409, code: 'revision_conflict' }))
  const model = createRoot((dispose) => {
    disposers.push(dispose)
    return createChangesModel({ id: 't1', projectId: 'p1' } as never, { shown: () => true } as never)
  })
  await vi.waitFor(() => expect(model.source.topology()?.files[0]?.patchKey).toBe(FIRST))

  await expect(model.source.loadSegments([{ path: 'a.txt', patchKey: FIRST, ordinal: 0 }], new AbortController().signal))
    .rejects.toMatchObject({ status: 409 })
  await vi.waitFor(() => expect(model.source.topology()?.files[0]?.patchKey).toBe(SECOND))
  expect(reads()).toBe(2)
  await flush()
  expect(reads()).toBe(2)
})

it('does not read the document again for any other failure', async () => {
  api.status.mockResolvedValue({
    branch: 'main', upstream: null, ahead: null, behind: null, operation: null,
    changes: [{ path: 'a.txt', status: 'modified', staged: false, additions: 1, deletions: 0, contentKey: 'k' }],
  })
  answering(FIRST)
  api.segments.mockRejectedValue(Object.assign(new Error('broken'), { status: 500 }))
  const model = createRoot((dispose) => {
    disposers.push(dispose)
    return createChangesModel({ id: 't1', projectId: 'p1' } as never, { shown: () => true } as never)
  })
  await vi.waitFor(() => expect(model.source.topology()?.files[0]?.patchKey).toBe(FIRST))
  await expect(model.source.loadSegments([{ path: 'a.txt', patchKey: FIRST, ordinal: 0 }], new AbortController().signal))
    .rejects.toMatchObject({ status: 500 })
  await flush()
  expect(reads()).toBe(1)
})

it('keeps the last document when a read of it fails', async () => {
  api.status.mockResolvedValue({
    branch: 'main', upstream: null, ahead: null, behind: null, operation: null,
    changes: [{ path: 'a.txt', status: 'modified', staged: false, additions: 1, deletions: 0, contentKey: 'k' }],
  })
  answering(FIRST)
  api.segments.mockRejectedValue(Object.assign(new Error('changed'), { status: 409, code: 'revision_conflict' }))
  const model = createRoot((dispose) => {
    disposers.push(dispose)
    return createChangesModel({ id: 't1', projectId: 'p1' } as never, { shown: () => true } as never)
  })
  await vi.waitFor(() => expect(model.source.topology()?.files[0]?.patchKey).toBe(FIRST))
  api.document.mockRejectedValue(Object.assign(new Error('broken'), { status: 500 }))
  await expect(model.source.loadSegments([{ path: 'a.txt', patchKey: FIRST, ordinal: 0 }], new AbortController().signal)).rejects.toBeTruthy()
  await vi.waitFor(() => expect(reads()).toBe(2))
  await flush()
  expect(model.source.topology()?.files[0]?.patchKey).toBe(FIRST)
})
