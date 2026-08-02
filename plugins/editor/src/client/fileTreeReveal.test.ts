import { describe, expect, it } from 'vitest'
import { canRevealActiveFile, directoryContainsFile } from './fileTreeReveal'

describe('directoryContainsFile', () => {
  it('matches descendants on a path-segment boundary', () => {
    expect(directoryContainsFile('src', 'src/app/index.ts')).toBe(true)
    expect(directoryContainsFile('src/app', 'src/app/index.ts')).toBe(true)
    expect(directoryContainsFile('src/app', 'src/application.ts')).toBe(false)
    expect(directoryContainsFile('src/app/index.ts', 'src/app/index.ts')).toBe(false)
  })
})

describe('canRevealActiveFile', () => {
  const context = {
    paneTaskId: 'task-1',
    activeTaskId: 'task-1',
    focusedPane: 'editor',
    activeFile: 'src/app.ts',
    treeAvailable: true,
  }

  it('is available only for the focused editor pane with an active file and tree', () => {
    expect(canRevealActiveFile(context)).toBe(true)
    expect(canRevealActiveFile({ ...context, focusedPane: 'changes' })).toBe(false)
    expect(canRevealActiveFile({ ...context, activeFile: null })).toBe(false)
    expect(canRevealActiveFile({ ...context, treeAvailable: false })).toBe(false)
    expect(canRevealActiveFile({ ...context, activeTaskId: 'task-2' })).toBe(false)
  })
})
