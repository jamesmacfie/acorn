import { expect, it, vi } from 'vitest'
import { gitlabEmitter } from './events'

it('says the merge-requests source changed beside the two pull request verbs only', () => {
  const send = vi.fn()
  const changed = vi.fn()
  const emit = gitlabEmitter(send, changed)
  emit('pulls-changed')
  emit('pr-synced', { number: 7 })
  emit('checks-changed')
  emit('repos-changed')
  expect(send).toHaveBeenCalledTimes(4)
  expect(send).toHaveBeenCalledWith({ channel: 'plugin:gitlab:pr-synced', number: 7 })
  expect(changed.mock.calls).toEqual([['merge-requests'], ['merge-requests']])
})
