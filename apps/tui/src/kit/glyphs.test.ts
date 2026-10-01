import { describe, expect, it } from 'vitest'
import { stringWidth } from '../width'
import { iconGlyph, spinnerGlyph } from './glyphs'

const agentNames = [
  'archive', 'circle', 'circle-alert', 'circle-check', 'circle-dashed', 'circle-question-mark',
  'circle-stop', 'clipboard-pen', 'clock', 'list-plus', 'loader-circle', 'shield-question-mark',
  'triangle-alert', 'workflow', 'x',
]

describe('terminal icon names', () => {
  it('covers the agent session, subagent, queue, and attention names', () => {
    for (const name of agentNames) expect(iconGlyph(name), name).not.toBeNull()
  })

  it('keeps every mark and spinner frame in one terminal cell', () => {
    for (const name of agentNames) expect(stringWidth(iconGlyph(name)!), name).toBe(1)
    for (let frame = 0; frame < 10; frame += 1) {
      expect(stringWidth(spinnerGlyph(frame))).toBe(1)
    }
  })

  it('omits names and literals without an explicit terminal mapping', () => {
    expect(iconGlyph('◆')).toBeNull()
    expect(iconGlyph('not-a-real-icon')).toBeNull()
    expect(iconGlyph('brand:agents/codex')).toBeNull()
    expect(iconGlyph('🚀')).toBeNull()
  })
})
