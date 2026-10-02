import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { gitOrThrow } from '../core/git'
import { invalidateWorktreeStatus, worktreeGitText, WORKTREE_STATUS_TTL_MS } from './worktreeStatus'

vi.mock('../core/git', () => ({ gitOrThrow: vi.fn() }))
const run = vi.mocked(gitOrThrow)
const answer = (stdout: string) => ({ stdout, stderr: '', code: 0, signal: null, timedOut: false, aborted: false, truncated: false, spawnError: null })
const deferred = () => {
  let resolve!: (value: ReturnType<typeof answer>) => void
  const promise = new Promise<ReturnType<typeof answer>>((r) => { resolve = r })
  return { promise, resolve }
}
const read = (path = '/fixture', fresh = false) => worktreeGitText(path, ['status'], { fresh })

beforeEach(() => {
  vi.useFakeTimers()
  invalidateWorktreeStatus()
  run.mockReset()
})
afterEach(() => {
  invalidateWorktreeStatus()
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})

it('expires abandoned completed reads through one clock', async () => {
  run.mockResolvedValue(answer('body'))
  await Promise.all(Array.from({ length: 24 }, (_, i) => read(`/fixture/${i}`)))
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(WORKTREE_STATUS_TTL_MS)
  expect(vi.getTimerCount()).toBe(0)
  await read('/fixture/0')
  expect(run).toHaveBeenCalledTimes(25)
})

it('keeps a fresh replacement when the older expiry fires', async () => {
  run.mockResolvedValueOnce(answer('old')).mockResolvedValueOnce(answer('new'))
  await read()
  await vi.advanceTimersByTimeAsync(1_000)
  await read('/fixture', true)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(await read()).toBe('new')
  expect(run).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['invalidate', 'reset', 'fresh', 'failure'] as const)('does not let an old completion replace or remove a %s successor', async (action) => {
  const old = deferred()
  run.mockReturnValueOnce(old.promise)
  const admitted = read()
  if (action === 'invalidate') invalidateWorktreeStatus('/fixture')
  if (action === 'reset') invalidateWorktreeStatus()
  if (action === 'failure') run.mockRejectedValueOnce(new Error('failed'))
  else run.mockResolvedValueOnce(answer('new'))
  const successor = await read('/fixture', action === 'fresh' || action === 'failure')
  old.resolve(answer('old'))
  expect(await admitted).toBe('old')
  expect(successor).toBe(action === 'failure' ? null : 'new')
  if (action === 'failure') {
    expect(vi.getTimerCount()).toBe(0)
    run.mockResolvedValueOnce(answer('retry'))
    expect(await read()).toBe('retry')
  } else expect(await read()).toBe('new')
})

it('reset retires a held result without creating an expiry timer on completion', async () => {
  const held = deferred()
  run.mockReturnValueOnce(held.promise)
  const admitted = read()
  invalidateWorktreeStatus()
  held.resolve(answer('retired'))
  expect(await admitted).toBe('retired')
  expect(vi.getTimerCount()).toBe(0)
  run.mockResolvedValueOnce(answer('replacement'))
  expect(await read()).toBe('replacement')
  expect(run).toHaveBeenCalledTimes(2)
})

it('expiry at the same instant as a new read cannot remove the running replacement', async () => {
  run.mockResolvedValueOnce(answer('old'))
  await read()
  vi.setSystemTime(Date.now() + WORKTREE_STATUS_TTL_MS)
  const held = deferred()
  run.mockReturnValueOnce(held.promise)
  const first = read()
  await vi.advanceTimersByTimeAsync(1)
  const joined = read()
  expect(run).toHaveBeenCalledTimes(2)
  held.resolve(answer('replacement'))
  expect(await first).toBe('replacement')
  expect(await joined).toBe('replacement')
})
