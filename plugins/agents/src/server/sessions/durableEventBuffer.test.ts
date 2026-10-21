import { describe, expect, it, vi } from 'vitest'
import { DurableAgentEventBuffer, type PendingAgentEvent } from './durableEventBuffer'

describe('DurableAgentEventBuffer', () => {
  it('commits the first chunk at once, coalesces the rest, and flushes them before the next protocol event', async () => {
    const committed: PendingAgentEvent[] = []
    const buffer = new DurableAgentEventBuffer(async (entry) => {
      committed.push(structuredClone(entry))
    })
    const delta = (text: string, messageId = 'm'): PendingAgentEvent => ({
      sessionId: 's',
      turnId: 't',
      event: { type: 'assistant_message', text, messageId, append: true },
    })
    await buffer.accept(delta('hel'))
    expect(committed.map((entry) => entry.event)).toEqual([delta('hel').event])
    await buffer.accept(delta('l'))
    await buffer.accept(delta('o'))
    expect(committed).toHaveLength(1)

    await buffer.accept({ sessionId: 's', turnId: 't', event: { type: 'turn_completed' } })
    expect(committed.map((entry) => entry.event)).toEqual([
      delta('hel').event,
      delta('lo').event,
      { type: 'turn_completed' },
    ])

    // A new message is a new stream: its first chunk goes at once as well.
    await buffer.accept(delta('next', 'm2'))
    expect(committed).toHaveLength(4)
  })

  it('bounds chunks and timer-flushes idle streams', async () => {
    vi.useFakeTimers()
    try {
      const committed: PendingAgentEvent[] = []
      const buffer = new DurableAgentEventBuffer(
        async (entry) => {
          committed.push(structuredClone(entry))
        },
        { maxBytes: 4, flushMs: 10 },
      )
      await buffer.accept({
        sessionId: 's',
        turnId: 't',
        event: { type: 'reasoning', text: 'four', append: true },
      })
      expect(committed).toHaveLength(1)
      await buffer.accept({
        sessionId: 's',
        turnId: 't',
        event: { type: 'reasoning', text: 'x', append: true },
      })
      await vi.advanceTimersByTimeAsync(10)
      expect(committed).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('splits a single oversized unicode delta without losing text or exceeding the durable limit', async () => {
    const committed: PendingAgentEvent[] = []
    const buffer = new DurableAgentEventBuffer(
      async (entry) => {
        committed.push(structuredClone(entry))
      },
      { maxBytes: 8 },
    )
    const text = 'one🙂two🙂three'
    await buffer.accept({
      sessionId: 's',
      turnId: 't',
      event: { type: 'assistant_message', text, append: true },
    })
    await buffer.flushAll()
    const chunks = committed.flatMap((entry) => (entry.event.type === 'assistant_message' ? [entry.event.text] : []))
    expect(chunks.join('')).toBe(text)
    expect(chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 8)).toBe(true)
  })
})
