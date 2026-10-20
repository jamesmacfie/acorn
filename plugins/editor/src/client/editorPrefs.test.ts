import { describe, expect, it } from 'vitest'
import { readEditorIndentation, readEditorLineBlame, readEditorMode, readEditorWordWrap } from './editorPrefs'

describe('the editor mode preference', () => {
  it('is graphical unless the stored value says terminal', () => {
    expect(readEditorMode(undefined)).toBe('graphical')
    expect(readEditorMode({})).toBe('graphical')
    expect(readEditorMode({ editor_mode: 'vim' })).toBe('graphical')
    expect(readEditorMode({ editor_mode: 'terminal' })).toBe('terminal')
  })
})

describe('editing defaults on this device', () => {
  it('starts unwrapped with two spaces and rejects invalid stored indentation', () => {
    expect(readEditorWordWrap(undefined)).toBe(false)
    expect(readEditorWordWrap({ editor_word_wrap: '1' })).toBe(true)
    expect(readEditorLineBlame(undefined)).toBe(true)
    expect(readEditorLineBlame({ editor_line_blame: '0' })).toBe(false)
    expect(readEditorIndentation(undefined)).toEqual({ mode: 'spaces', width: 2 })
    expect(readEditorIndentation({ editor_indentation: 'tabs:4' })).toEqual({ mode: 'tabs', width: 4 })
    expect(readEditorIndentation({ editor_indentation: 'spaces:3' })).toEqual({ mode: 'spaces', width: 2 })
  })
})
