import { describe, expect, it } from 'vitest'
import type { AgentAttachment } from '@acorn/protocol/managedAgents.ts'
import { decideReplacement, MAX_DRAFT_ATTACHMENT_BYTES } from './replaceAttachment'

// The compare-and-swap at the heart of "a plugin edited this attachment, put the new one in the turn"
// (docs/managed-agents.md § Draft attachments).
//
// Worth its own suite because the failure modes are silent and expensive. Getting the order of the
// checks wrong deletes a person's attachment; getting the index wrong reorders their turn; missing the
// aggregate ceiling means the node refuses the whole turn at enqueue with nothing pointing at why.

const file = (over: Partial<AgentAttachment> = {}): AgentAttachment => ({
  id: 'a1',
  taskId: 'task',
  filename: 'shot.png',
  mediaType: 'image/png',
  byteSize: 1_000,
  createdAt: 1,
  ...over,
})

const decide = (over: Partial<Parameters<typeof decideReplacement>[0]> = {}) =>
  decideReplacement({
    current: [file()],
    expectedId: 'a1',
    replacement: file({ id: 'a2' }),
    taskId: 'task',
    ...over,
  })

describe('deciding whether a draft attachment may be replaced', () => {
  it('swaps exactly one element and keeps the order', () => {
    const decision = decide({
      current: [file({ id: 'a0' }), file({ id: 'a1' }), file({ id: 'a9' })],
    })
    expect(decision).toEqual({
      kind: 'replace',
      next: [file({ id: 'a0' }), file({ id: 'a2' }), file({ id: 'a9' })],
    })
  })

  // The one that loses data if the checks are ordered wrong. Storage is content addressed, so applying
  // an edit that changed no pixels hands back the source's own id. Read as a replacement it looks like
  // "that attachment is already in this draft", and the caller deletes the candidate — which is the
  // attachment the reader is still using.
  it('treats a candidate that deduplicated back to the source as a no-op, not a refusal', () => {
    expect(decide({ replacement: file({ id: 'a1' }) })).toEqual({ kind: 'noop' })
  })

  it('refuses a contributor naming an attachment this slot is not showing', () => {
    expect(decide({ claimedExpectedId: 'somebody-elses' })).toMatchObject({ kind: 'refuse' })
  })

  it('accepts a contributor that named the right one, and one that named none', () => {
    expect(decide({ claimedExpectedId: 'a1' }).kind).toBe('replace')
    expect(decide({ claimedExpectedId: undefined }).kind).toBe('replace')
  })

  it('refuses a replacement from another task', () => {
    expect(decide({ replacement: file({ id: 'a2', taskId: 'other' }) }))
      .toMatchObject({ kind: 'refuse', reason: expect.stringContaining('another task') })
  })

  it('refuses a replacement that is not an image', () => {
    expect(decide({ replacement: file({ id: 'a2', mediaType: 'application/pdf' }) }))
      .toMatchObject({ kind: 'refuse', reason: expect.stringContaining('image') })
  })

  // The reader removed it, sent the turn, or switched sessions while the editor was open.
  it('refuses when the source has left the draft', () => {
    expect(decide({ current: [file({ id: 'other' })] }))
      .toMatchObject({ kind: 'refuse', reason: expect.stringContaining('no longer in this draft') })
  })

  it('refuses a replacement the draft already holds elsewhere', () => {
    expect(decide({ current: [file({ id: 'a1' }), file({ id: 'a2' })] }))
      .toMatchObject({ kind: 'refuse', reason: expect.stringContaining('already in this draft') })
  })

  it('counts the aggregate without the attachment being replaced', () => {
    const half = Math.floor(MAX_DRAFT_ATTACHMENT_BYTES / 2)
    // The source is being swapped out, so a same-sized replacement leaves the total where it was.
    expect(decide({
      current: [file({ id: 'a1', byteSize: half }), file({ id: 'a0', byteSize: half })],
      replacement: file({ id: 'a2', byteSize: half }),
    }).kind).toBe('replace')
    // One byte more and it does not fit.
    expect(decide({
      current: [file({ id: 'a1', byteSize: half }), file({ id: 'a0', byteSize: half })],
      replacement: file({ id: 'a2', byteSize: half + 1 }),
    })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('25 MiB') })
  })
})
