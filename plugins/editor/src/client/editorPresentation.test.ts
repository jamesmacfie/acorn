import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { documentCustody } from '@acorn/plugin-api/ui/editor'
import { inferIndentation, movePresentation, presentationFor, prunePresentation, saveLabel, setPresentation } from './editorPresentation'

describe('editor presentation', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('infers only a bounded, unambiguous indentation sample', () => {
    expect(inferIndentation('root\n  child\n    grandchild')).toEqual({ mode: 'spaces', width: 2 })
    expect(inferIndentation('root\n    child\n        grandchild')).toEqual({ mode: 'spaces', width: 4 })
    expect(inferIndentation('root\n        child')).toEqual({ mode: 'spaces', width: 8 })
    expect(inferIndentation('root\n\tchild')).toEqual({ mode: 'tabs', width: 2 })
    expect(inferIndentation('root\n  child\n\tother')).toEqual({ mode: 'spaces', width: 2 })
    expect(inferIndentation('root\nchild')).toEqual({ mode: 'spaces', width: 2 })
    expect(inferIndentation(`${'unindented\n'.repeat(200)}        later`)).toEqual({ mode: 'spaces', width: 2 })
    expect(inferIndentation(`${'x'.repeat(64 * 1024)}\n        later`)).toEqual({ mode: 'spaces', width: 2 })
    expect(inferIndentation(`${'é'.repeat(40 * 1024)}\n        later`)).toEqual({ mode: 'spaces', width: 2 })
    expect(inferIndentation('root\r\n    child')).toEqual({ mode: 'spaces', width: 4 })
  })

  it('keeps a tab override through rename and removes only its own scope', () => {
    setPresentation('node', 'task', 'src/file.ts', { wrap: true, indentation: { mode: 'tabs', width: 4 } })
    setPresentation('other', 'task', 'src/file.ts', { wrap: false })
    movePresentation('node', 'task', 'src', 'lib')
    expect(presentationFor('node', 'task', 'lib/file.ts')).toEqual({ wrap: true, indentation: { mode: 'tabs', width: 4 } })
    expect(presentationFor('node', 'task', 'src/file.ts')).toEqual({})
    prunePresentation('node', 'task', 'lib')
    expect(presentationFor('node', 'task', 'lib/file.ts')).toEqual({})
    expect(presentationFor('other', 'task', 'src/file.ts')).toEqual({ wrap: false })
    prunePresentation('other')
  })

  it('reports later edits after a delayed save acknowledgement and a failed retry', async () => {
    const custody = documentCustody(['phase05-test', 'file', 'task', 'file'], 'saved', 'revision')
    custody.editText('first')
    expect(saveLabel(custody, null)).toBe('Unsaved')
    let acknowledge!: (value: { text: string; revision: string }) => void
    const pending = custody.flush(() => new Promise((resolve) => { acknowledge = resolve }))
    expect(saveLabel(custody, null)).toBe('Saving…')
    custody.editText('later')
    acknowledge({ text: 'first', revision: 'next' })
    await pending
    expect(saveLabel(custody, null)).toBe('Unsaved')
    await expect(custody.flush(async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    expect(saveLabel(custody, null)).toBe('Save failed')
    expect(saveLabel(custody, 'deleted')).toBe('Deleted on disk')
    expect(saveLabel(custody, 'changed')).toBe('Changed on disk')
    expect(saveLabel(custody, 'unknown')).toBe('Recovered draft')
    await custody.flush(async (text) => ({ text, revision: 'last' }))
    expect(saveLabel(custody, null)).toBe('Saved')
  })
})
