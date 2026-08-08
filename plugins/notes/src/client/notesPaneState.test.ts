import { describe, expect, it } from 'vitest'
import { evictNotesPaneState, libraryCollapsed, notesSelectionFor, rememberNotesSelection, setLibraryCollapsed } from './notesPaneState'

describe('notes pane state', () => {
  it('remembers selection and collapse per task', () => {
    rememberNotesSelection('task-a', { scope: 'workspace', slug: 'design' })
    setLibraryCollapsed('task-a', true)
    setLibraryCollapsed('task-b', false)

    expect(notesSelectionFor('task-a')).toEqual({ scope: 'workspace', slug: 'design' })
    expect(libraryCollapsed('task-a')).toBe(true)
    expect(libraryCollapsed('task-b')).toBe(false)
    expect(libraryCollapsed('missing')).toBe(false)
  })

  it('evicts all state owned by an archived task', () => {
    rememberNotesSelection('task-evict', { scope: 'task', slug: 'scratchpad' })
    setLibraryCollapsed('task-evict', true)
    evictNotesPaneState('task-evict')

    expect(notesSelectionFor('task-evict')).toBeUndefined()
    expect(libraryCollapsed('task-evict')).toBe(false)
  })
})
