import { expect, it, vi } from 'vitest'
import { githubEmitter } from './events'

it('says the pull-requests source changed beside the two pull request verbs only', () => {
  const send = vi.fn()
  const changed = vi.fn()
  const emit = githubEmitter(send, changed)
  emit('pulls-changed', { repoOwner: 'acme', repoName: 'app' })
  emit('pr-synced', { repoOwner: 'acme', repoName: 'app', pullNumber: 7 })
  emit('checks-changed')
  emit('repos-changed')
  expect(send).toHaveBeenCalledTimes(4)
  expect(send).toHaveBeenCalledWith({ channel: 'plugin:github:pulls-changed', repoOwner: 'acme', repoName: 'app' })
  expect(changed.mock.calls).toEqual([['pull-requests'], ['pull-requests']])
})

it('says nothing changed in the source when the refresh found every row as it was', () => {
  const send = vi.fn()
  const changed = vi.fn()
  const emit = githubEmitter(send, changed)
  emit('pr-synced', { pullNumber: 7 }, { unchanged: true })
  expect(send).toHaveBeenCalledWith({ channel: 'plugin:github:pr-synced', pullNumber: 7 })
  expect(changed).not.toHaveBeenCalled()
})
