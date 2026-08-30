import { afterEach, describe, expect, it } from 'vitest'
import { sourceRegistry } from '../../host/registries/sources/sources'
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

describe('an origin a source declares but does not share an id with', () => {
  it('draws the glyph the source named for it', () => {
    dispose = sourceRegistry.register({
      id: 'tracker', label: 'Tracker', glyph: 'square-check', order: 10,
      origins: { 'tracker-item': 'git-pull-request' },
    }).dispose
    expect(taskOriginAppearance('tracker-item')).toEqual({ glyph: 'git-pull-request' })
    // And core's own origin never asks a source at all.
    expect(taskOriginAppearance('local')).toEqual({ glyph: 'circle-dot' })
  })
})
