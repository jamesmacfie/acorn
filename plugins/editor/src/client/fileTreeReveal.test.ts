import { describe, expect, it } from 'vitest'
import { canRevealActiveFile } from './fileTreeReveal'

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
