import { describe, expect, it } from 'vitest'
import { evictNotesPaneState, notesSelectionFor, rememberNotesSelection } from './notesPaneState'

describe('notes pane state', () => {
  it('remembers selection per task', () => {
    rememberNotesSelection('task-a', { scope: 'workspace', slug: 'design' })

    expect(notesSelectionFor('task-a')).toEqual({ scope: 'workspace', slug: 'design' })
  })

  it('evicts all state owned by an archived task', () => {
    rememberNotesSelection('task-evict', { scope: 'task', slug: 'scratchpad' })
    evictNotesPaneState('task-evict')

    expect(notesSelectionFor('task-evict')).toBeUndefined()
  })
})
