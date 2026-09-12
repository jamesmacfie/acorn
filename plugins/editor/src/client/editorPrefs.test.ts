import { describe, expect, it } from 'vitest'
import { readEditorMode } from './editorPrefs'

describe('the editor mode preference', () => {
  it('is graphical unless the stored value says terminal', () => {
    expect(readEditorMode(undefined)).toBe('graphical')
    expect(readEditorMode({})).toBe('graphical')
    expect(readEditorMode({ editor_mode: 'vim' })).toBe('graphical')
    expect(readEditorMode({ editor_mode: 'terminal' })).toBe('terminal')
  })
})
