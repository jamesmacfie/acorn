import { createRoot, createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'

// The Changes model's side of a revision conflict (./changesModel.tsx § conflicted): a segment asked
// for against a digest the node no longer describes reads the document again, once, and the viewer
// draws the new revision. The node's refusal is covered in ../server/routes/localGit.test.ts.

vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: undefined }), useQueryClient: () => ({}) }))
vi.mock('@acorn/plugin-api/ui/host', () => ({ registerKeybindings: () => ({ dispose() {} }) }))
const inline = vi.hoisted(() => ({ capability: undefined as unknown }))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...await original<Record<string, unknown>>(),
  clientCapability: () => inline.capability,
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
  inline.capability = undefined
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

// The host draws a line's card inside a tracked expression, and the task's sessions move whenever any
// of them does. The card has to survive that, or its textarea loses focus mid-sentence.
it('keeps an open inline card mounted while the task\'s sessions update', async () => {
  const [sessions, setSessions] = createSignal<unknown[]>([])
  const Card = vi.fn(() => <textarea />)
  inline.capability = { prime() {}, reportPatches() {}, sessionsForTask: () => sessions(), Card }
  api.status.mockResolvedValue({
    branch: 'main', upstream: null, ahead: null, behind: null, operation: null,
    changes: [{ path: 'a.txt', status: 'modified', staged: false, additions: 1, deletions: 0, contentKey: 'k' }],
  })
  answering(FIRST)
  const model = createRoot((dispose) => {
    disposers.push(dispose)
    return createChangesModel({ id: 't1', projectId: 'p1' } as never, { shown: () => true } as never)
  })
  await vi.waitFor(() => expect(model.source.topology()?.files[0]?.patchKey).toBe(FIRST))
  const row = { path: 'a.txt', kind: 'add', newNo: 1, oldNo: null, raw: '+x' } as never
  model.source.inlineChat!.open(row)
  const host = document.createElement('div')
  disposers.push(render(() => <div>{model.source.inlineChat!.render(row)}</div>, host))
  const textarea = host.querySelector('textarea')
  expect(textarea).toBeTruthy()

  setSessions([{ id: 'other', taskId: 't1', lastEventSeq: 1 }])
  setSessions([{ id: 'other', taskId: 't1', lastEventSeq: 2 }])
  expect(Card).toHaveBeenCalledTimes(1)
  expect(host.querySelector('textarea')).toBe(textarea)
})
