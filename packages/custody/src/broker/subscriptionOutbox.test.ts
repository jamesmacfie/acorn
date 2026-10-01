import { describe, expect, it } from 'vitest'
import { SubscriptionOutbox } from './subscriptionOutbox'

const subscription = (viewerId: string, key: string, state: 'attached' | 'detached', cols = 80) => ({ viewerId, frame: { channel: `sample:${state}`, id: key, cols }, intent: { key, state } })

describe('subscription reconnect intent', () => {
  it('eliminates completed cycles and restores final state once at the final size', () => {
    for (const final of ['detached', 'attached'] as const) {
      const queue = new SubscriptionOutbox()
      for (let i = 0; i < 1000; i++) { queue.push(subscription('a', 'stream', 'attached', i + 2)); queue.push(subscription('a', 'stream', 'detached')) }
      if (final === 'attached') queue.push(subscription('a', 'stream', 'attached', 192))
      expect(queue.drain()).toEqual(final === 'attached' ? [subscription('a', 'stream', 'attached', 192)] : [])
    }
  })

  it('preserves commands as FIFO barriers, multiple streams, and unknown plugin frames', () => {
    const queue = new SubscriptionOutbox()
    const input = { viewerId: 'a', frame: { channel: 'term:input', data: 'typed' } }
    const unknown = { viewerId: 'b', frame: { channel: 'plugin-new:action', value: 3 } }
    const first = subscription('a', 'one', 'attached')
    const second = subscription('a', 'two', 'attached')
    queue.push(first); queue.push(input); queue.push(second); queue.push(unknown); queue.push(subscription('a', 'one', 'detached'))
    expect(queue.drain()).toEqual([first, input, second, unknown, subscription('a', 'one', 'detached')])
  })

  it('seeds live subscriptions before commands and retires only the closed viewer', () => {
    const queue = new SubscriptionOutbox()
    const input = { viewerId: 'b', frame: { channel: 'term:input', data: 'b stays' } }
    queue.push(input)
    queue.seed([subscription('a', 'one', 'attached'), subscription('b', 'one', 'attached')])
    queue.push(subscription('a', 'one', 'detached'))
    queue.retire('a')
    expect(queue.drain()).toEqual([subscription('b', 'one', 'attached'), input])
    expect(queue.drain()).toEqual([])
  })
})
