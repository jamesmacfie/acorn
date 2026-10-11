import { afterEach, expect, it } from 'vitest'
import { evictScope } from '@acorn/plugin-api/testkit/client'
import {
  clearComposerExpansion,
  composerExpanded,
  composerExpansionSlice,
  toggleComposerExpanded,
} from './composerPrefs'

afterEach(() => evictScope({ scope: 'node-switched' }))

it('restores saved booleans without replacing choices made before hydration', () => {
  toggleComposerExpanded('task', 'edited')
  toggleComposerExpanded('task', 'edited')
  const stored = composerExpansionSlice.codec.parse(
    '{"edited":true,"expanded":true,"collapsed":false,"invalid":"false"}',
  )
  expect(stored).toEqual({ edited: true, expanded: true, collapsed: false })
  composerExpansionSlice.binding!.hydrate('task', stored)
  expect(composerExpanded('task', 'edited')).toBe(false)
  expect(composerExpanded('task', 'expanded')).toBe(true)
  expect(composerExpanded('task', 'collapsed')).toBe(false)
  expect(composerExpanded('task', 'missing')).toBe(false)
  for (const malformed of ['broken JSON', null, [], 'true']) {
    expect(composerExpansionSlice.codec.parse(malformed)).toEqual({})
  }
})

it('cleans up deleted sessions and archived tasks and restores only the selected Node preferences', () => {
  toggleComposerExpanded('task', 'deleted')
  toggleComposerExpanded('task', 'retained')
  toggleComposerExpanded('other-task', 'other')
  clearComposerExpansion('deleted')
  expect(composerExpansionSlice.binding!.values().task).toEqual({ retained: true })
  evictScope({ scope: 'task', taskId: 'other-task' })
  expect(composerExpanded('other-task', 'other')).toBe(false)
  expect(composerExpanded('task', 'retained')).toBe(true)
  const saved = JSON.stringify(composerExpansionSlice.codec.serialize(composerExpansionSlice.binding!.values().task))
  evictScope({ scope: 'node-switched', from: 'A', to: 'B' })
  expect(composerExpanded('task', 'retained')).toBe(false)
  evictScope({ scope: 'node-switched', from: 'B', to: 'A' })
  composerExpansionSlice.binding!.hydrate('task', composerExpansionSlice.codec.parse(saved))
  expect(composerExpanded('task', 'retained')).toBe(true)
  expect(composerExpanded('task', 'deleted')).toBe(false)
})
