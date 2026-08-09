import { afterEach, describe, expect, it } from 'vitest'
import { consumePaneIntent, evictPendingIntents } from './clientEvents'
import { openPluginContentTarget } from './contentLinks'

afterEach(() => evictPendingIntents('task-1'))

describe('declarative content-link resolution', () => {
  it('opens the declared pane and retains the captured item as its selection', () => {
    expect(openPluginContentTarget({ kind: 'board.card', pane: 'board', item: 'ENG-42' }, 'task-1')).toBe(true)
    expect(consumePaneIntent('task-1', 'board')).toEqual({ kind: 'plugin:select', item: 'ENG-42' })
  })

  it('leaves malformed or taskless targets for the browser', () => {
    expect(openPluginContentTarget({ kind: 'board.card', pane: 'board' }, 'task-1')).toBe(false)
    expect(openPluginContentTarget({ kind: 'board.card', pane: 'board', item: 'ENG-42' }, null)).toBe(false)
  })
})
