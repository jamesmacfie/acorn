import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { Hono } from 'hono'
import type { ReviewNote } from '../shared/api'
import { reviewNotesRoutes } from '../server/routes/reviewNotes'
import { seedReviewNotes } from './reviewNotes'

// Seeded notes are the rows the pane reads: the route lists them back in the order they were written.
describe('seeding review notes', () => {
  let ctx: TestNodeContext
  beforeEach(() => { ctx = makeTestNodeContext({ plugin: { name: 'changes' } }) })
  afterEach(() => ctx.cleanup())

  it('writes unsent notes the review-notes route returns in order', async () => {
    const db = ctx.storage.open()
    const notes = Array.from({ length: 250 }, (_, index) => ({ path: `src/file-${index % 5}.ts`, side: 'additions' as const, line: index + 1, snippet: null, body: `note ${index}` }))
    expect(await seedReviewNotes(db, 'task-1', notes)).toBe(250)
    const app = new Hono().route('/', reviewNotesRoutes(db, ctx.core))
    const listed = await (await app.request('/task-1/review-notes')).json() as ReviewNote[]
    expect(listed.map((note) => note.body)).toEqual(notes.map((note) => note.body))
    expect(listed.every((note) => note.sentAt == null && note.startLine === note.endLine)).toBe(true)
  })
})
