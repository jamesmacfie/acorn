import { createRoot } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalChange } from '@acorn/protocol/terminal.ts'
import { groupChanges } from './model'
import { createCommitState, DRAFT_PREFIX, type CommitDeps } from './commitState'

// The commit editor's state, in a reactive root of its own. `.tsx` rather than `.ts` so it runs in
// the jsdom project, because the draft is a `localStorage` key and the node project has no such
// thing (plugins/vitest.shared.ts).
//
// Every dependency is a stub. What is real is the draft, the three options, the mode, and what a
// commit does to all four; ../server/routes/localGit.test.ts has the git end.

const change = (path: string, staged: boolean, status: LocalChange['status'] = 'modified'): LocalChange => ({
  path,
  status,
  staged,
  additions: null,
  deletions: null,
})

const commit = vi.fn(async () => ({ ok: true }) as { ok: boolean; reason?: string })
const commitMessage = vi.fn(async () => ({ message: 'feat: written for you', providerId: 'anthropic', modelId: 'a-model' }))
const headCommit = vi.fn(async () => ({ sha: 'abc123', message: 'feat: the last one\n\nwith a body' }))
const onError = vi.fn()
const onCommitted = vi.fn()

const disposers: (() => void)[] = []

const build = (changes: LocalChange[], over: Partial<CommitDeps> = {}) => createRoot((dispose) => {
  disposers.push(dispose)
  return createCommitState({
    taskId: 'task-1',
    groups: () => groupChanges(changes),
    headCommit,
    commit,
    commitMessage,
    onError,
    onCommitted,
    ...over,
  })
})

beforeEach(() => {
  localStorage.clear()
  for (const stub of [commit, headCommit, commitMessage, onError, onCommitted]) stub.mockClear()
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

describe('what the button will do', () => {
  it('commits the index with something staged, and every tracked change without', async () => {
    const staged = build([change('a.ts', true)])
    expect(staged.commitMode()).toBe('staged')
    staged.setDraft('feat: one')
    await staged.commit()
    expect(commit).toHaveBeenCalledWith('feat: one', { all: false, amend: false, signoff: false, noVerify: false })

    const tracked = build([change('a.ts', false)])
    expect(tracked.commitMode()).toBe('tracked')
    tracked.setDraft('feat: two')
    await tracked.commit()
    // `all` is the client's answer to "nothing is staged". The node never guesses it.
    expect(commit).toHaveBeenLastCalledWith('feat: two', { all: true, amend: false, signoff: false, noVerify: false })
  })

  it('refuses a blank message, and a clean tree unless it is an amend', async () => {
    const clean = build([])
    expect(clean.canCommit()).toBe(false)
    clean.setDraft('   ')
    expect(clean.canCommit()).toBe(false)
    clean.setDraft('feat: nothing to see')
    // Nothing a commit could pick up, so the button stays off.
    expect(clean.canCommit()).toBe(false)
    await clean.commit()
    expect(commit).not.toHaveBeenCalled()

    // An amend on a clean tree is a reword, which is a commit with nothing new in it.
    await clean.toggleAmend()
    expect(clean.canCommit()).toBe(true)
    await clean.commit()
    expect(commit).toHaveBeenCalledWith('feat: nothing to see', { all: false, amend: true, signoff: false, noVerify: false })
  })

  it('carries sign-off and skip-hooks through as they are set', async () => {
    const state = build([change('a.ts', true)])
    state.setDraft('feat: flags')
    state.setSignoff(true)
    state.setNoVerify(true)
    await state.commit()
    expect(commit).toHaveBeenCalledWith('feat: flags', { all: false, amend: false, signoff: true, noVerify: true })
  })
})

describe('amend', () => {
  it('fills an empty message from HEAD and leaves a written one alone', async () => {
    const state = build([change('a.ts', true)])
    await state.toggleAmend()
    expect(state.amend()).toBe(true)
    expect(state.draft()).toBe('feat: the last one\n\nwith a body')

    // Off and on again, with text in the field: the reader's message wins over HEAD's.
    await state.toggleAmend()
    state.setDraft('feat: mine')
    await state.toggleAmend()
    expect(state.draft()).toBe('feat: mine')
    // And HEAD was not read a second time: a field with text in it has no room for the prefill, so
    // there is nothing to ask for.
    expect(headCommit).toHaveBeenCalledTimes(1)
  })

  it('leaves the field empty on a branch with no commit to amend', async () => {
    const state = build([change('a.ts', true)], { headCommit: async () => null })
    await state.toggleAmend()
    expect(state.amend()).toBe(true)
    expect(state.draft()).toBe('')
  })

  it('turns amend on and commits in one call, for the chord', async () => {
    const state = build([change('a.ts', true)])
    await state.amendCommit()
    expect(commit).toHaveBeenCalledWith('feat: the last one\n\nwith a body', { all: false, amend: true, signoff: false, noVerify: false })
  })
})

describe('after a commit', () => {
  it('clears the draft and the amend flag, and re-reads the tree', async () => {
    const state = build([change('a.ts', true)])
    state.setDraft('feat: landed')
    await state.toggleAmend()
    await state.commit()

    expect(state.draft()).toBe('')
    expect(state.amend()).toBe(false)
    expect(onError).toHaveBeenLastCalledWith('')
    expect(onCommitted).toHaveBeenCalledTimes(1)
    // Cleared on this device too, so a relaunch does not bring back a message that was committed.
    expect(localStorage.getItem(`${DRAFT_PREFIX}task-1`)).toBeNull()
  })

  it('keeps the draft when a before-commit handler says no, and shows the reason', async () => {
    commit.mockResolvedValueOnce({ ok: false, reason: 'commit-lint: subject too long' })
    const state = build([change('a.ts', true)])
    state.setDraft('feat: a subject a handler will object to')
    await state.commit()

    expect(state.draft()).toBe('feat: a subject a handler will object to')
    expect(onError).toHaveBeenCalledWith('commit-lint: subject too long')
    expect(onCommitted).not.toHaveBeenCalled()
  })
})

describe('the draft on this device', () => {
  it('is written on every keystroke under the task it belongs to', () => {
    const state = build([change('a.ts', true)])
    state.setDraft('feat: half a th')
    expect(localStorage.getItem(`${DRAFT_PREFIX}task-1`)).toBe('feat: half a th')
  })

  it('comes back on a fresh state, which is what a relaunch and a trip to the diff both are', () => {
    localStorage.setItem(`${DRAFT_PREFIX}task-1`, 'feat: typed before the reload')
    expect(build([change('a.ts', true)]).draft()).toBe('feat: typed before the reload')
  })

  it('does not follow the reader to another task', () => {
    localStorage.setItem(`${DRAFT_PREFIX}task-1`, 'feat: task one')
    const other = createRoot((dispose) => {
      disposers.push(dispose)
      return createCommitState({
        taskId: 'task-2', groups: () => groupChanges([]), headCommit, commit, commitMessage, onError, onCommitted,
      })
    })
    expect(other.draft()).toBe('')
  })
})

// The generated message goes through `setDraft`, which is the same door typed text uses: it is
// persisted, the commit button re-reads its own state, and `before-commit` sees a message with
// nothing special about it. There is no second path to a commit.
describe('a message somebody else wrote', () => {
  it('lands in the draft, where a commit picks it up unchanged', async () => {
    const state = build([change('a.ts', true)])
    await state.generate({ backendId: 'conn-1', modelId: 'a-model' })
    expect(commitMessage).toHaveBeenCalledWith({ backendId: 'conn-1', modelId: 'a-model' })
    expect(state.draft()).toBe('feat: written for you')
    expect(localStorage.getItem(`${DRAFT_PREFIX}task-1`)).toBe('feat: written for you')

    await state.commit()
    expect(commit).toHaveBeenCalledWith('feat: written for you', { all: false, amend: false, signoff: false, noVerify: false })
  })

  it('puts a refusal in the alert and leaves the field alone', async () => {
    const state = build([change('a.ts', true)], {
      commitMessage: () => Promise.reject(Object.assign(new Error('The tree is clean.'), { code: 'nothing_to_commit' })),
    })
    state.setDraft('feat: mine')
    await state.generate({ backendId: 'conn-1' })
    expect(onError).toHaveBeenLastCalledWith('The tree is clean.')
    expect(state.draft()).toBe('feat: mine')
  })

  // The backend is passed only so the alert can say the right next step for a CLI that is installed
  // but signed out, which fails the same way an unreachable provider does.
  it('sends a signed-out CLI to a terminal', async () => {
    const state = build([change('a.ts', true)], {
      commitMessage: () => Promise.reject(Object.assign(new Error('x'), { code: 'provider_unavailable' })),
    })
    await state.generate({ backendId: 'harness:claude-code' }, { kind: 'harness', label: 'Claude Code' })
    expect(onError).toHaveBeenLastCalledWith('Claude Code did not answer. Run it once in a terminal to check it is signed in.')
  })

  it('refuses a second press while a provider is still writing', async () => {
    let release = () => {}
    const state = build([change('a.ts', true)], {
      commitMessage: () => new Promise((resolve) => {
        release = () => resolve({ message: 'feat: late', providerId: 'p', modelId: 'm' })
      }),
    })
    const first = state.generate({ backendId: 'conn-1' })
    expect(state.generating()).toBe(true)
    await state.generate({ backendId: 'conn-1' })
    release()
    await first
    expect(state.generating()).toBe(false)
    expect(state.draft()).toBe('feat: late')
  })

  // Whatever is in the field was worth more than nothing, and a provider that answered with
  // whitespace has said nothing to put there.
  it('leaves the field alone when the answer is blank', async () => {
    const state = build([change('a.ts', true)], {
      commitMessage: () => Promise.resolve({ message: '   ', providerId: 'p', modelId: 'm' }),
    })
    state.setDraft('feat: mine')
    await state.generate({ backendId: 'conn-1' })
    expect(state.draft()).toBe('feat: mine')
  })
})
