import { createEffect, createRoot } from 'solid-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setActiveNode } from '@acorn/plugin-api/client'
const transport = vi.hoisted(() => ({ listeners: new Map<string, (event: any) => void>(), detached: 0 }))
vi.mock('./wsChannel', () => ({ wsDockerAttach: (_kind: string, id: string, callback: (event: any) => void) => {
  transport.listeners.set(id, callback)
  return () => { transport.listeners.delete(id); transport.detached++ }
} }))
import { dockerLogBuffer } from './dockerLogStore'
import { retireDockerClient } from './dockerScope'
beforeEach(() => { vi.useFakeTimers(); setActiveNode('a'); transport.detached = 0 })
afterEach(() => { retireDockerClient(); setActiveNode(null); vi.useRealTimers() })
const emit = (id: string, data: string) => transport.listeners.get(id)!({ kind: 'log', data })

it('retains the exact UTF-16 tail, clear, huge chunks, and split surrogates', () => {
  const buffer = dockerLogBuffer('c')
  let expected = ''
  for (const data of ['x'.repeat(600000), '\ud83d', '\ude00', 'tail', 'y'.repeat(524287)]) {
    emit('c', data); expected = (expected + data).slice(-524288)
    expect(buffer.text()).toBe(expected)
  }
  buffer.clear()
  expect(buffer.text()).toBe('')
  emit('c', 'after clear')
  expect(buffer.text()).toBe('after clear')
})

it('shares two views, publishes at a bounded cadence, and keeps hidden continuity', async () => {
  const first = dockerLogBuffer('c'), second = dockerLogBuffer('c')
  let reads = 0, latest = '', stop!: () => void
  createRoot(dispose => { stop = dispose; createEffect(() => { latest = first.text(); reads++ }) })
  for (let i = 0; i < 100; i++) emit('c', 'x')
  expect(second.text()).toBe('x'.repeat(100))
  expect(reads).toBe(1)
  await vi.advanceTimersByTimeAsync(50)
  expect(reads).toBe(2)
  expect(latest).toBe(second.text())
  stop()
  emit('c', 'hidden')
  expect(dockerLogBuffer('c').text()).toBe('x'.repeat(100) + 'hidden')
  expect(transport.detached).toBe(0)
})

it('evicts the oldest of eight attachments and reopens ended streams', () => {
  const first = dockerLogBuffer('c0')
  for (let i = 1; i <= 8; i++) dockerLogBuffer(`c${i}`)
  expect(transport.listeners.has('c0')).toBe(false)
  expect(first.ended()).toBe(true)
  transport.listeners.get('c8')!({ kind: 'end' })
  const reopened = dockerLogBuffer('c8')
  expect(reopened.ended()).toBe(false)
  expect(reopened.text()).toBe('')
})

it('retires outgoing tails and timers before a colliding Node attaches', () => {
  const a = dockerLogBuffer('same')
  emit('same', 'from A')
  const clear = vi.spyOn(globalThis, 'clearTimeout')
  setActiveNode('b')
  expect(a.ended()).toBe(true)
  expect(clear).toHaveBeenCalled()
  clear.mockRestore()
  const b = dockerLogBuffer('same')
  emit('same', 'from B')
  a.clear()
  expect(b.text()).toBe('from B')
  expect(a.text()).toBe('')
})
