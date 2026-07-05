import { describe, expect, it } from 'vitest'
import {
  closeFile,
  editorActivate,
  editorClose,
  editorOpen,
  editorSetDirty,
  hydrateEditorState,
  nextActive,
  openFileIn,
  openFiles,
  activeFile,
  promoteFile,
  serializeEditorState,
  setFileDirty,
  type OpenFile,
} from './editorState'

const f = (path: string, over: Partial<OpenFile> = {}): OpenFile => ({ path, ephemeral: false, dirty: false, ...over })

describe('open/promote/close/dirty transitions (docs/next 07)', () => {
  it('ephemeral opens reuse the single preview slot', () => {
    let list = openFileIn([], 'a.ts', true)
    list = openFileIn(list, 'b.ts', true)
    expect(list).toEqual([f('b.ts', { ephemeral: true })])
    list = openFileIn(list, 'c.ts', false)
    expect(list.map((x) => x.path)).toEqual(['b.ts', 'c.ts'])
  })
  it('a dirty preview tab survives the next preview open', () => {
    const dirtyPreview = [f('a.ts', { ephemeral: true, dirty: true })]
    expect(openFileIn(dirtyPreview, 'b.ts', true)).toHaveLength(2)
  })
  it('re-opening a preview non-ephemerally promotes it; promote is explicit too', () => {
    const list = [f('a.ts', { ephemeral: true })]
    expect(openFileIn(list, 'a.ts', false)[0].ephemeral).toBe(false)
    expect(promoteFile(list, 'a.ts')[0].ephemeral).toBe(false)
  })
  it('an edit marks dirty AND promotes the preview slot', () => {
    const list = setFileDirty([f('a.ts', { ephemeral: true })], 'a.ts', true)
    expect(list[0]).toEqual(f('a.ts', { dirty: true }))
    expect(setFileDirty(list, 'a.ts', false)[0].dirty).toBe(false)
  })
  it('close removes; nextActive picks the neighbour', () => {
    const list = [f('a.ts'), f('b.ts'), f('c.ts')]
    expect(closeFile(list, 'b.ts').map((x) => x.path)).toEqual(['a.ts', 'c.ts'])
    expect(nextActive(list, 'b.ts', 'b.ts')).toBe('c.ts')
    expect(nextActive(list, 'c.ts', 'c.ts')).toBe('b.ts')
    expect(nextActive(list, 'b.ts', 'a.ts')).toBe('a.ts') // closing an inactive tab keeps focus
    expect(nextActive([f('a.ts')], 'a.ts', 'a.ts')).toBeNull()
  })
})

describe('store + persistence round-trip', () => {
  it('open/activate/close through the store; serialize → hydrate restores tabs without dirty', () => {
    editorOpen('t9', 'src/a.ts', false)
    editorOpen('t9', 'src/b.ts', true)
    editorSetDirty('t9', 'src/a.ts', true)
    editorActivate('t9', 'src/a.ts')
    expect(openFiles('t9').map((x) => x.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(activeFile('t9')).toBe('src/a.ts')

    const blob = serializeEditorState()
    editorClose('t9', 'src/a.ts')
    editorClose('t9', 'src/b.ts')
    expect(openFiles('t9')).toEqual([])
    hydrateEditorState(blob)
    expect(openFiles('t9').map((x) => x.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(openFiles('t9').every((x) => !x.dirty)).toBe(true) // content isn't persisted
    expect(activeFile('t9')).toBe('src/a.ts')
    hydrateEditorState('{bad json') // never throws
  })
})
