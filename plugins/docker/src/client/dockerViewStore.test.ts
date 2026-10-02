import { expect, it } from 'vitest'
import { clientEvents, setActiveNode } from '@acorn/plugin-api/client'
import { dockerSelection, rememberDockerSelection, revealDockerResource, consumeDockerReveal, rememberDockerDetailState, dockerDetailState } from './dockerViewStore'

it('partitions same-ID task selection, detail state, and archive eviction by Node', () => {
  setActiveNode('a')
  rememberDockerSelection('same', 'A')
  rememberDockerDetailState('same', 'container', { tab: 'logs', logQuery: 'A', logFollow: false, logScrollTop: 0 })
  revealDockerResource('images', 'A')
  setActiveNode('b')
  expect(dockerSelection('same')).toBeUndefined()
  expect(dockerDetailState('same', 'container')).toBeUndefined()
  expect(consumeDockerReveal()).toBeNull()
  rememberDockerSelection('same', 'B')
  clientEvents.emit('runtime:task-archived', { taskId: 'same' })
  expect(dockerSelection('same')).toBeUndefined()
  setActiveNode('a')
  expect(dockerSelection('same')).toBe('A')
  expect(dockerDetailState('same', 'container')?.logQuery).toBe('A')
  clientEvents.emit('runtime:task-archived', { taskId: 'same' })
  expect(dockerDetailState('same', 'container')).toBeUndefined()
  setActiveNode(null)
})
