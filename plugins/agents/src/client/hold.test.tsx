import { describe, expect, it } from 'vitest'
import { createRoot, createSignal } from 'solid-js'
import { hold } from './hold'

describe('hold', () => {
  it('follows the source while it is set and keeps the last value once it is not', () => {
    createRoot((dispose) => {
      const [source, setSource] = createSignal<{ id: string } | undefined>({ id: 'a' })
      const held = hold(source, source()!)
      setSource({ id: 'b' })
      expect(held().id).toBe('b')
      setSource(undefined)
      expect(held().id).toBe('b')
      dispose()
    })
  })
})
