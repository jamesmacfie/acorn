import { afterEach, describe, expect, it } from 'vitest'
import { sourceRegistry } from '../registries/sources'
import { taskOriginAppearance } from './origin'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
})

describe('task origin appearance', () => {
  it('falls back safely when the creating plugin is disabled', () => {
    expect(taskOriginAppearance('tracker:item')).toEqual({ glyph: 'circle-dot', tooltip: 'tracker:item' })
  })

  it('uses a live source contribution when one owns the origin', () => {
    dispose = sourceRegistry.register({ id: 'tracker', label: 'Tracker', glyph: 'square-check', order: 10 }).dispose
    expect(taskOriginAppearance('tracker')).toEqual({ glyph: 'square-check' })
  })
})
