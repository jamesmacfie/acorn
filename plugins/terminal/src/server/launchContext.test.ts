import { describe, expect, it, vi } from 'vitest'
import { deliverLaunchContext, readLaunchContext } from './launchContext'

describe('terminal launch context', () => {
  it('delivers contributions in registry order within one UTF-8 byte budget', async () => {
    const sent: string[] = []
    const large = vi.fn(async () => '€'.repeat(100_000))
    await deliverLaunchContext('task', 'session', [
      { id: 'first', value: { read: async () => 'First' } },
      { id: 'second', value: { read: async () => 'Second' } },
      { id: 'large', value: { read: large } },
    ], (_id, text) => sent.push(text), vi.fn())
    expect(large).toHaveBeenCalledOnce()
    expect(sent.slice(0, 2)).toEqual(['First', 'Second'])
    expect(sent).toHaveLength(3)
    expect(Buffer.byteLength(sent.join(''), 'utf8')).toBeLessThanOrEqual(262_144)
    expect(sent[2]).not.toContain('�')
  })

  it('reads the complete system-prompt block before launch, including both maximum Unicode indexes', async () => {
    const text = '😀'.repeat(32_000) + '\n[MEMORY.md truncated: call memory_list.]'
    expect(await readLaunchContext('task', [{ id: 'memory', value: { read: async () => text } }], vi.fn())).toBe(text)
  })

  it('continues after a contributor fails', async () => {
    const sent: string[] = []
    const warn = vi.fn()
    await deliverLaunchContext('task', 'session', [
      { id: 'broken', value: { read: async () => { throw new Error('unavailable') } } },
      { id: 'memory', value: { read: async () => 'Memory block' } },
    ], (_id, text) => sent.push(text), warn)
    expect(sent).toEqual(['Memory block'])
    expect(warn).toHaveBeenCalledOnce()
  })
})
