/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it, vi } from 'vitest'
import { tasksKey } from '@acorn/protocol/api.ts'
import { dispatchLayout } from '@acorn/client-core/features/tasks/tasks.ts'
import { registerContextMenuItems } from '@acorn/client-core/host/registries/panes'
import { recordedRequests, TASK } from './fixture'
import { focusedRenderable } from './keys/regions'
import { renderFixture } from './harness'
import { enterDetail, openFirstSession, stopSaying } from './agentsDriving'

// Driving the agent pane, rather than reading it.
//
// `panes.test.tsx` asks whether an agents transcript has what it needs on the first screen. This file
// asks whether a reader at a terminal can run an agent: open a run, answer what it is blocked on, say
// something back, and start another one. Each case ends at a recorded POST, because what a pane sends
// is the feature, and what it draws is not proof of that.
//
// 120 by 40 throughout. Below 80 cells `list-detail` draws one column at a time, so the composer and
// the approval sit behind the layout's group switch (./layouts/ListDetail.tsx).

const posts = () =>
  recordedRequests()
    .filter((request) => request.method === 'POST')
    .map((request) => request.path)

describe('running an agent from a terminal', () => {
  it('can activate the completed Codex plan without treating a planning answer as implementation', async () => {
    process.env.ACORN_FIXTURE_CODEX_PLAN = '1'
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await screen.until('Implement plan')
      let found = false
      const trail: string[] = []
      // A session row can be clipped in the narrow browse column, so use the visible caret row.
      // Git adds a Menu stop before Agents; traverse the full menu and browse focus cycle.
      for (let step = 0; step < 18 && !found; step += 1) {
        const caret = (await screen.frame()).split('\n').find((line) => line.includes('›')) ?? ''
        trail.push(caret.trim())
        found = caret.includes('Find why the old passwo')
        if (!found) await screen.press('TAB')
      }
      expect(found, trail.join(' | ')).toBe(true)
      await screen.press('RETURN')
      await enterDetail(screen)
      const frame = await screen.until('Implement plan')
      expect(frame).toContain('Update the API')
      expect(frame).toContain('Blocked by acorn-permission-policy')
      expect(posts()).toEqual([])
      await stopSaying(screen, 'Implement plan')
      await screen.press('RETURN')
      expect(posts()).toEqual(['/v1/p/agents/sessions/session-1/implement-plan'])
    } finally {
      screen.done()
      delete process.env.ACORN_FIXTURE_CODEX_PLAN
    }
  }, 180_000)

  it('shows the sessions for the newly opened task', async () => {
    const other = { ...TASK, id: 'task-2', title: 'other-task', branch: 'other-task', sort: 1 }
    const screen = await renderFixture({
      pane: 'agents',
      width: 120,
      height: 40,
      cache: (client) => client.setQueryData(tasksKey, [TASK, other]),
    })
    try {
      expect(await screen.until('Find why the old password still works')).toContain('Agents 1')
      dispatchLayout(other.id, { type: 'show', pane: 'agents' })
      await screen.press('ARROW_DOWN')
      expect((await screen.caret()).text).toContain('other-task')
      const preview = await screen.frame()
      expect(preview.split('\n')[0]).toContain('Task to open: other-task')
      expect(preview).toContain('Find why the old password still works')
      await screen.press('RETURN')
      const opened = await screen.until('Agents 0')
      expect(opened.split('\n')[0]).toContain('Task: other-task')
      expect(opened).toContain('Agents 0')
      expect(opened).not.toContain('Find why the old password still works')
    } finally {
      screen.done()
    }
  }, 180_000)

  it('opens a run and sends a turn to it', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      await stopSaying(screen, 'Ask the agent')
      for (const key of ['h', 'i']) await screen.press(key)
      const typed = await screen.frame()
      expect(typed).toContain('hi')
      // The footer names the key that sends, at the field that takes it.
      expect(typed).toContain('ctrl+return send')
      expect(posts()).toEqual([])

      await screen.press('RETURN', { ctrl: true })
      expect(posts()).toEqual(['/v1/p/agents/sessions/session-1/turns'])
    } finally {
      screen.done()
    }
  }, 180_000)

  // Where the keys go when a reader opens a run. A chat surface is one you arrive at to write, so the
  // message box is what the column hands them to, and everything else is a step away from it
  // (./keys/regions.ts § markEntry).
  it('puts the keys in the message box when the run opens', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      // By node kind, not by the placeholder: the draft is a module signal keyed by session and
      // outlives a render, so a case that runs after one which typed something finds that text in the
      // box. What is being claimed is that the keys are in the message box, and the kind says it.
      expect(focusedRenderable()?.kind).toBe('textarea')
      // And the header above it is still a walk away, because an arrow at the field's first line
      // leaves the field rather than being swallowed (./keys/install.ts § typeInto).
      await stopSaying(screen, 'New')
      expect((await screen.caret()).text).toContain('New')
    } finally {
      screen.done()
    }
  }, 180_000)

  // `onSubmit` on the shared props means "Enter without a modifier. Absent leaves Enter as a newline",
  // and the composer's own hint says "Shift+Enter for newline". Binding it to the `commit` chord alone
  // would make that hint describe a keyboard nobody has.
  it('sends on Enter and keeps Shift+Enter for a newline', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      for (const key of ['h', 'i']) await screen.press(key)

      await screen.press('RETURN', { shift: true })
      expect(posts()).toEqual([])

      await screen.press('RETURN')
      expect(posts()).toEqual(['/v1/p/agents/sessions/session-1/turns'])
    } finally {
      screen.done()
    }
  }, 180_000)

  it('answers what the run is blocked on', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      await stopSaying(screen, 'Allow')
      await screen.press('RETURN')
      expect(posts()).toEqual(['/v1/p/agents/sessions/session-1/requests/request-1/resolve'])
    } finally {
      screen.done()
    }
  }, 180_000)

  // The create-a-run control. `New` is a `Picker`, which on this host is a `Menu` with a filter field
  // over provider rows. Inside the header's `Toolbar`, a panel laid out in the few cells the trigger
  // has runs `Claude Code` and `Available` together, and a reader can't tell what they are choosing
  // (./kit/grouping/blocks.tsx § Toolbar).
  it('starts a new run from the header, and the provider row is readable', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      await stopSaying(screen, 'New')
      await screen.press('RETURN')

      const open = await screen.frame()
      expect(open).toContain('Filter agents…')
      expect(open).toContain('Claude Code')

      await stopSaying(screen, 'Claude Code')
      await screen.press('RETURN')
      expect(posts()).toEqual(['/v1/p/agents/sessions'])
    } finally {
      screen.done()
    }
  }, 180_000)

  // The session-actions menu has the same clipping trap: its rows must read as words rather than as
  // the first few cells of one.
  it('offers the session actions as whole words', async () => {
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      // The visible label identifies the action without relying on a Lucide substitute.
      await stopSaying(screen, 'Session actions')
      await screen.press('RETURN')
      // `until`, not `frame`: the rows are built from the provider list, which is a resource the pane
      // is still fetching when the menu opens.
      const open = await screen.until('Fork session')
      for (const row of ['Fork session', 'Rename session', 'Copy session ID', 'Export Markdown', 'Archive session']) {
        expect(open).toContain(row)
      }
    } finally {
      screen.done()
    }
  }, 180_000)
})

// Another plugin's rows on a message and on a finished turn: the same rows the desktop draws, in the
// same menus, reached by keys. When a row may run is the card's own test
// (plugins/agents/src/client/sessions/AgentEventCard.test.tsx).
describe('other plugins’ rows on a transcript', () => {
  it('files a message from the response’s Copy menu', async () => {
    const fileNote = vi.fn()
    const rows = registerContextMenuItems([
      { id: 'note', location: 'agent.message', label: 'File as note', order: 0, run: fileNote },
    ])
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      await stopSaying(screen, 'Copy this response or act on it')
      await screen.press('RETURN')
      expect(await screen.until('File as note')).toContain('Copy as JSON')
      await stopSaying(screen, 'File as note')
      await screen.press('RETURN')
      expect(fileNote).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'agent.message',
          sessionId: 'session-1',
          taskId: 'task-1',
          projectId: 'project-1',
          turnId: 'turn-1',
          role: 'assistant',
          status: 'completed',
          text: 'The reset writes a new hash but `signIn` still checks the one it was passed.',
        }),
      )
      expect(posts()).toEqual([])
    } finally {
      rows.dispose()
      screen.done()
    }
  }, 180_000)

  // The terminal has no text selection, so a message offers its whole text, as plain text, from an
  // explicit menu after it.
  it('offers a message’s whole text to a selection action', async () => {
    const explain = vi.fn()
    const rows = registerContextMenuItems([
      { id: 'explain', location: 'content.selection', label: 'Explain', order: 0, run: explain },
    ])
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await openFirstSession(screen)
      await enterDetail(screen)
      await stopSaying(screen, 'Actions for the whole text')
      await screen.press('RETURN')
      await screen.until('Explain')
      await stopSaying(screen, 'Explain')
      await screen.press('RETURN')
      expect(explain).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'content.selection',
          taskId: 'task-1',
          projectId: 'project-1',
          ownerId: 'agents',
          contentKind: 'markdown',
          readOnly: true,
          text: 'The reset writes a new hash but signIn still checks the one it was passed.',
          resource: expect.objectContaining({ kind: 'message', sessionId: 'session-1' }),
        }),
      )
      expect(posts()).toEqual([])
    } finally {
      rows.dispose()
      screen.done()
    }
  }, 180_000)

  it('acts on a finished turn from its closing line', async () => {
    process.env.ACORN_FIXTURE_CODEX_PLAN = '1'
    const review = vi.fn()
    const rows = registerContextMenuItems([
      { id: 'review', location: 'agent.turn', label: 'Review turn', order: 0, run: review },
    ])
    const screen = await renderFixture({ pane: 'agents', width: 120, height: 40 })
    try {
      await screen.until('Implement plan')
      await openFirstSession(screen)
      await enterDetail(screen)
      await stopSaying(screen, 'Actions for this turn')
      await screen.press('RETURN')
      await screen.until('Review turn')
      await stopSaying(screen, 'Review turn')
      await screen.press('RETURN')
      expect(review).toHaveBeenCalledWith(
        expect.objectContaining({ location: 'agent.turn', turnId: 'turn-1', status: 'completed' }),
      )
    } finally {
      rows.dispose()
      screen.done()
      delete process.env.ACORN_FIXTURE_CODEX_PLAN
    }
  }, 180_000)
})
