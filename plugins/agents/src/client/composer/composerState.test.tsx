import { afterEach, expect, it, vi } from 'vitest'
import { setActiveNode } from '@acorn/plugin-api/testkit/client'
import { clearComposerDraft, clearComposerDrafts, composerDraftState } from './composerState'
import { readComposerPayload } from './composerDraftStorage'

// Migration must survive a quota failure without multiplying Node-owned attachment ids.
afterEach(() => { vi.restoreAllMocks(); clearComposerDrafts(); localStorage.clear(); setActiveNode(null) })

it('claims legacy payload once and preserves its source when storage rejects the migration', () => {
  localStorage.setItem('acorn.agent-draft.legacy-failure', 'unsent')
  localStorage.setItem('acorn.agent-attachments.legacy-failure', '["attachment-A"]')
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  const a = composerDraftState('legacy-failure', 'A')
  expect(a.text()).toBe('unsent')
  expect(a.attachmentIds()).toEqual(['attachment-A'])
  expect(composerDraftState('legacy-failure', 'B').attachmentIds()).toEqual([])
  expect(localStorage.getItem('acorn.agent-draft.legacy-failure')).toBe('unsent')
  write.mockRestore()
  a.setText('edited')
  expect(readComposerPayload('A', 'legacy-failure').text).toBe('edited')
})

it('restores scoped unsent work, shares guards, and deletes only the addressed Node draft', () => {
  setActiveNode('A')
  const a = composerDraftState('same')
  a.setText('A unsent')
  a.setUploading(true)
  expect(composerDraftState('same').uploading()).toBe(true)
  setActiveNode('B')
  const b = composerDraftState('same')
  b.setText('B unsent')
  a.setUploading(false)
  expect(b.uploading()).toBe(false)
  clearComposerDraft('same', 'A')
  a.setText('late A write')
  clearComposerDrafts()
  expect(composerDraftState('same', 'A').text()).toBe('')
  expect(composerDraftState('same', 'B').text()).toBe('B unsent')
})

it('keeps legacy source through a partial field write and restores scoped edits before retrying', () => {
  localStorage.setItem('acorn.agent-draft.partial-fields', 'legacy text')
  localStorage.setItem('acorn.agent-attachments.partial-fields', '["legacy-image"]')
  const original = Storage.prototype.setItem
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.endsWith('.contexts')) throw new Error('quota')
    original.call(this, key, value)
  })
  const a = composerDraftState('partial-fields', 'partial-A')
  a.setText('edited text')
  expect(localStorage.getItem('acorn.agent-draft.partial-fields')).toBe('legacy text')
  expect(composerDraftState('partial-fields', 'partial-B').attachmentIds()).toEqual([])
  clearComposerDrafts()
  const restored = composerDraftState('partial-fields', 'partial-A')
  expect(restored.text()).toBe('edited text')
  expect(restored.attachmentIds()).toEqual(['legacy-image'])
  write.mockRestore()
  restored.setText('saved text')
  expect(localStorage.getItem('acorn.agent-draft.partial-fields')).toBeNull()
  clearComposerDrafts()
  expect(composerDraftState('partial-fields', 'partial-A').text()).toBe('saved text')
})
