import { describe, expect, it } from 'vitest'
import {
  editorTreeDirectoryOpen,
  evictEditorTreeState,
  moveEditorTreeDirectories,
  setEditorTreeDirectoryOpen,
} from './editorTreeState'

describe('editor tree state', () => {
  it('remembers nested expansion while a parent is collapsed', () => {
    setEditorTreeDirectoryOpen('tree-nested', 'src', true)
    setEditorTreeDirectoryOpen('tree-nested', 'src/core', true)

    setEditorTreeDirectoryOpen('tree-nested', 'src', false)
    expect(editorTreeDirectoryOpen('tree-nested', 'src')).toBe(false)
    expect(editorTreeDirectoryOpen('tree-nested', 'src/core')).toBe(true)

    setEditorTreeDirectoryOpen('tree-nested', 'src', true)
    expect(editorTreeDirectoryOpen('tree-nested', 'src/core')).toBe(true)
  })

  it('scopes expansion by task and evicts only the archived task', () => {
    setEditorTreeDirectoryOpen('tree-task-a', 'src', true)
    setEditorTreeDirectoryOpen('tree-task-b', 'test', true)

    expect(editorTreeDirectoryOpen('tree-task-a', 'test')).toBe(false)
    expect(editorTreeDirectoryOpen('tree-task-b', 'src')).toBe(false)

    evictEditorTreeState('tree-task-a')
    expect(editorTreeDirectoryOpen('tree-task-a', 'src')).toBe(false)
    expect(editorTreeDirectoryOpen('tree-task-b', 'test')).toBe(true)
  })

  it('keeps equal task IDs on different Nodes independent during an in-flight move', () => {
    setEditorTreeDirectoryOpen('same-task', 'src', true, 'first-node')
    setEditorTreeDirectoryOpen('same-task', 'src', true, 'second-node')
    setEditorTreeDirectoryOpen('same-task', 'src/old', true, 'first-node')
    moveEditorTreeDirectories('same-task', 'src/old', 'src/new', 'first-node')
    expect(editorTreeDirectoryOpen('same-task', 'src/new', 'first-node')).toBe(true)
    expect(editorTreeDirectoryOpen('same-task', 'src/old', 'first-node')).toBe(false)
    expect(editorTreeDirectoryOpen('same-task', 'src/new', 'second-node')).toBe(false)
    expect(editorTreeDirectoryOpen('same-task', 'src', 'second-node')).toBe(true)
  })
})
