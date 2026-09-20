import { describe, expect, it } from 'vitest'
import type { PanelLayout } from './layout'
import type { PanelDefinition } from './model'
import { panelGridHeight, panelPlaceholderStyle, panelSlotStyle } from './panelGridGeometry'

const panel = (id: string): PanelDefinition => ({
  id,
  title: id,
  sources: [],
  shaping: {},
  view: { kind: 'list' },
})

const layout: PanelLayout = {
  order: ['one', 'two'],
  rects: {
    one: { x: 0, y: 0, w: 2, h: 2 },
    two: { x: 2, y: 2, w: 3, h: 1 },
  },
}

describe('panel grid pixel projection', () => {
  it('derives container depth and slot pixels without changing cell geometry', () => {
    expect(panelGridHeight([panel('one'), panel('two')], layout, 50, 4)).toBe(146)
    expect(panelSlotStyle('one', layout, false, 50, 4)).toEqual({
      left: '0px',
      top: '0px',
      width: '96px',
      height: '96px',
    })
    expect(layout.rects.one).toEqual({ x: 0, y: 0, w: 2, h: 2 })
  })

  it('keeps collapsed panels in document flow and composes the live drag offset', () => {
    expect(panelSlotStyle('one', layout, true, 50, 4)).toEqual({})
    expect(panelSlotStyle('one', layout, false, 50, 4, { id: 'one', offset: { x: 3, y: -2 } })).toEqual({
      left: '0px',
      top: '0px',
      width: '96px',
      height: '96px',
      transform: 'translate(3px, -2px) scale(1.015)',
    })
    expect(panelPlaceholderStyle(layout, 50, 4, 'two')).toEqual({
      left: '100px',
      top: '100px',
      width: '146px',
      height: '46px',
    })
  })
})
