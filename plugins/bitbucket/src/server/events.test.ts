import { expect, it, vi } from 'vitest'
import { bitbucketEmitter } from './events'

it('says the pull-requests source changed beside the two pull request verbs only', () => {
  const send = vi.fn()
  const changed = vi.fn()
  const emit = bitbucketEmitter(send, changed)
  emit('pulls-changed')
  emit('pr-synced', { number: 7 })
  emit('checks-changed')
  emit('repos-changed')
  expect(send).toHaveBeenCalledTimes(4)
  expect(send).toHaveBeenCalledWith({ channel: 'plugin:bitbucket:pr-synced', number: 7 })
  expect(changed.mock.calls).toEqual([['pull-requests'], ['pull-requests']])
})
