import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import type { AgentConversationItem } from './conversationItems'
import type { AgentTurn } from '../../contract/wire.ts'

const implementPlan = vi.fn(async () => ({}))

let markdownMounts = 0
vi.mock('./ManagedAgentMarkdown', () => ({
  default: (props: { text: string }) => { markdownMounts++; return <span>{props.text}</span> },
}))

// The attachment card behind a sent turn asks the node for the row before it draws anything, so a
// card under test would otherwise reach the network. A PDF is the case that draws without bytes.
vi.mock('./managedClient', () => ({
  managedAgentApi: {
    attachment: async (id: string) => ({
      id, taskId: 'task', filename: 'notes.pdf', mediaType: 'application/pdf', byteSize: 2048, createdAt: 0,
    }),
    attachmentContent: async () => { throw new Error('bytes are only fetched for a picture') },
    implementPlan,
  },
}))

const dispatchLayout = vi.fn()
vi.mock('@acorn/plugin-api/client', async (original) => ({ ...await original<Record<string, unknown>>(), dispatchLayout }))

const { default: AgentEventCard, withoutAttachmentPlaceholders, withoutPastedMarkers } = await import('./AgentEventCard')
const { buildConversationItems } = await import('./conversationItems')

const fileChange = (event: Extract<AgentConversationItem['event'], { type: 'file_change' }>): AgentConversationItem =>
  ({ key: 'change', firstSeq: 1, lastSeq: 1, createdAt: 1, turnId: 'turn-1', event })

const drawCard = (item: AgentConversationItem) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <AgentEventCard item={item} taskId="task" sessionId="session" />, host)
  return { host, dispose: () => { dispose(); host.remove() } }
}

const openInChanges = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].find((element) => element.textContent?.includes('Open in Changes'))

it('opens a file change in place to show that step’s diff, and keeps the way to Changes', () => {
  dispatchLayout.mockClear()
  const { host, dispose } = drawCard(fileChange({
    type: 'file_change', path: 'src/a.ts', patch: '@@ -3,2 +3,2 @@\n keep\n-old\n+new', changeId: 'toolu_1',
  }))
  try {
    const details = host.querySelector('details')!
    expect(details.querySelector('summary')?.textContent).toContain('Changed src/a.ts')
    // Nothing is built behind a closed row.
    expect(host.querySelector('.diff-row')).toBeNull()
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    expect(host.querySelector('.diff-add')?.textContent).toContain('new')
    expect(host.querySelector('.diff-del')?.textContent).toContain('old')
    expect(host.querySelector('.diff-add .diff-gutter:nth-child(2)')?.textContent).toBe('4')
    // Read-only: no comment control on any line.
    expect(host.querySelector('.diff-add-btn')).toBeNull()
    openInChanges(host)!.click()
    expect(dispatchLayout).toHaveBeenCalledWith('task', { type: 'show', pane: 'changes' })
  } finally { dispose() }
})

it('leaves an excerpt’s line numbers blank rather than counting from the excerpt', () => {
  const { host, dispose } = drawCard(fileChange({
    type: 'file_change', path: 'src/a.ts', patch: '@@ -1,2 +1,2 @@\n keep\n-old\n+new', changeId: 'toolu_1', snippet: true,
  }))
  try {
    const details = host.querySelector('details')!
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    expect([...host.querySelectorAll('.diff-gutter')].map((gutter) => gutter.textContent)).toEqual(['', '', '', '', '', ''])
  } finally { dispose() }
})

it('says a stored patch is too large, and still links to Changes', () => {
  const { host, dispose } = drawCard(fileChange({ type: 'file_change', path: 'big.ts', patchArtifactId: 'artifact-1' }))
  try {
    const details = host.querySelector('details')!
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    expect(host.textContent).toContain('This diff is too large to show here.')
    expect(openInChanges(host)).toBeDefined()
  } finally { dispose() }
})

it('keeps a change with no patch as the link to Changes it always was', () => {
  dispatchLayout.mockClear()
  const { host, dispose } = drawCard(fileChange({ type: 'file_change', summary: 'Codex updated files.' }))
  try {
    expect(host.querySelector('details')).toBeNull()
    expect(host.textContent).toContain('Changed files')
    host.querySelector<HTMLElement>('[role="button"], button')!.click()
    expect(dispatchLayout).toHaveBeenCalledWith('task', { type: 'show', pane: 'changes' })
  } finally { dispose() }
})

it('draws Codex’s whole-turn diff once, as its latest version, one file after another', () => {
  const turnDiff = (seq: number, diff: string) => ({
    id: String(seq), sessionId: 'session', turnId: 'turn-1', seq, schemaVersion: 1, searchText: null, createdAt: seq,
    event: { type: 'file_change' as const, patch: diff, changeId: 'turn:t1', summary: 'All changes this turn' },
  })
  const items = buildConversationItems([
    turnDiff(1, 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-a\n+b'),
    turnDiff(2, 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/c.ts b/c.ts\n@@ -1 +1 @@\n-c\n+d'),
  ])
  expect(items).toHaveLength(1)
  const { host, dispose } = drawCard(items[0])
  try {
    const details = host.querySelector('details')!
    expect(details.querySelector('summary')?.textContent).toContain('All changes this turn')
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    expect([...host.querySelectorAll('.diff-file-path')].map((path) => path.textContent)).toEqual(['a.ts', 'c.ts'])
  } finally { dispose() }
})

it('offers the completed Codex proposal in the shared desktop and terminal card', async () => {
  implementPlan.mockClear()
  const item: AgentConversationItem = {
    key: 'proposal', firstSeq: 2, lastSeq: 2, createdAt: 2, turnId: 'turn-1',
    event: { type: 'plan_proposal', itemId: 'plan-1', providerTurnId: 'codex-turn-1', text: '1. Update the API' },
  }
  const host = document.createElement('div')
  document.body.append(host)
  const changed = vi.fn()
  const dispose = render(() => <AgentEventCard item={item} taskId="task" sessionId="session"
    planHandoffState="actionable" onPlanImplemented={changed} />, host)
  try {
    const button = [...host.querySelectorAll('button')].find((element) => element.textContent?.includes('Implement plan'))
    expect(button).toBeDefined()
    button!.click()
    button!.click()
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(implementPlan).toHaveBeenCalledOnce()
    expect(implementPlan).toHaveBeenCalledWith('session', 'plan-1')
  } finally { dispose(); host.remove() }

  const handled = document.createElement('div')
  const disposeHandled = render(() => <AgentEventCard item={item} taskId="task" sessionId="session"
    planHandoffState="handled" />, handled)
  try {
    expect(handled.textContent).toContain('Implementation started')
    expect(handled.textContent).not.toContain('Implement plan')
  } finally { disposeHandled() }
})

it('puts a focusable local time with the full timestamp on both sides of a conversation', () => {
  const at = Date.parse('2026-09-25T03:24:18Z')
  for (const type of ['user_message', 'assistant_message'] as const) {
    const item: AgentConversationItem = {
      key: type, firstSeq: 1, lastSeq: 1, createdAt: at, turnId: null,
      event: { type, text: 'A message' },
    }
    const host = document.createElement('div')
    const dispose = render(() => <AgentEventCard item={item} taskId="task" sessionId="session" />, host)
    try {
      const time = host.querySelector<HTMLElement>('[data-tip-at]')
      expect(time?.getAttribute('data-tip-at')).toBe(String(at))
      expect(time?.getAttribute('data-tip')).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone)
      expect(time?.tabIndex).toBe(0)
      expect(time?.textContent).toBeTruthy()
      expect(time?.getAttribute('data-emphasis')).toBe('eyebrow')
    } finally { dispose() }
  }
})

it('drops the attachment placeholder only when there is an attachment to draw instead', async () => {
  expect(withoutAttachmentPlaceholders('Have a look\n\n[Attachment: 8f2c]\n\nthanks'))
    .toBe('Have a look\n\nthanks')
  // Nothing that merely mentions one: the placeholder is a line of its own, written by the projection.
  expect(withoutAttachmentPlaceholders('see [Attachment: 8f2c] above')).toBe('see [Attachment: 8f2c] above')

  const item: AgentConversationItem = {
    key: 'turn', firstSeq: 1, lastSeq: 1, createdAt: 1, turnId: 'turn-1',
    event: { type: 'user_message', text: 'Have a look\n\n[Attachment: 8f2c]' },
  }
  const turn = { id: 'turn-1', input: [{ type: 'attachment', attachmentId: '8f2c' }] } as AgentTurn
  const host = document.createElement('div')
  const dispose = render(() => (
    <AgentEventCard item={item} taskId="task" sessionId="session" turn={turn} />
  ), host)
  try {
    expect(host.textContent).toContain('Have a look')
    expect(host.textContent).not.toContain('[Attachment:')
    // The row is drawn once the node has answered.
    await vi.waitFor(() => expect(host.textContent).toContain('notes.pdf'))
  } finally { dispose() }
})

it('hides the marker lines around another author\'s text, and leaves other text alone', () => {
  expect(withoutPastedMarkers('Final message:\n\n<pasted_content id="ab12cd34">\nDone.\n</pasted_content id="ab12cd34">'))
    .toBe('Final message:\n\nDone.')
  expect(withoutPastedMarkers('a\n\n\n\nb')).toBe('a\n\n\n\nb')
})

it('does not render a completed subagent’s history until its disclosure opens', () => {
  markdownMounts = 0
  const item: AgentConversationItem = {
    key: 'subagent', firstSeq: 1, lastSeq: 1001, createdAt: 1, turnId: null,
    event: { type: 'subagent', subagent: { id: 'child', title: 'Completed run', status: 'completed' } },
    children: Array.from({ length: 1000 }, (_, index) => ({
      key: `message-${index}`, firstSeq: index + 2, lastSeq: index + 2, createdAt: index + 2, turnId: null,
      event: { type: 'assistant_message', text: `Message ${index}` },
    })),
  }
  const host = document.createElement('div')
  const dispose = render(() => <AgentEventCard item={item} taskId="task" sessionId="session" />, host)
  try {
    expect(markdownMounts).toBe(0)
    expect(host.textContent).toContain('Completed run')
    const fold = host.querySelector('details')!
    fold.open = true
    fold.dispatchEvent(new Event('toggle'))
    expect(markdownMounts).toBe(1000)
    expect(host.textContent).toContain('Message 999')
    fold.open = false
    fold.dispatchEvent(new Event('toggle'))
    fold.open = true
    fold.dispatchEvent(new Event('toggle'))
    expect(markdownMounts).toBe(1000)
  } finally { dispose() }
})

// The same card in its two states. A request that is still blocking draws the control that answers it,
// in the thread and at the moment it interrupted; once it is answered the same seat holds the record,
// including the part nothing else keeps, which is what the reader did not pick.
const askedItem: AgentConversationItem = {
  key: 'ask', firstSeq: 1, lastSeq: 1, createdAt: 1, turnId: null,
  event: {
    type: 'request',
    requestId: 'ask-1',
    kind: 'question',
    title: 'Which drink do you want on a cold morning?',
    questions: [{
      id: 'drink',
      prompt: 'Drink',
      options: [{ id: 'tea', label: 'Tea' }, { id: 'coffee', label: 'Coffee' }],
    }],
  },
}

const requestRow = (status: 'pending' | 'resolved', resolution: unknown) => ({
  id: 'row', sessionId: 'session', turnId: null, providerRequestId: 'ask-1',
  kind: 'question' as const, status, title: 'Which drink do you want on a cold morning?',
  detail: null, payload: { options: [], questions: askedItem.event.type === 'request' ? askedItem.event.questions : [] },
  resolution, expiresAt: null, createdAt: 0, resolvedAt: null,
})

it('answers a blocking question in the thread, and keeps the answer in the same seat', () => {
  const host = document.createElement('div')
  const dispose = render(() => (
    <AgentEventCard item={askedItem} taskId="task" sessionId="session" request={requestRow('pending', null)} />
  ), host)
  try {
    // Blocking: the control is there to answer with.
    expect(host.querySelector('select')).not.toBeNull()
    expect(host.textContent).toContain('Submit answers')
  } finally { dispose() }

  const settled = document.createElement('div')
  const disposeSettled = render(() => (
    <AgentEventCard
      item={askedItem}
      taskId="task"
      sessionId="session"
      request={requestRow('resolved', { answers: { drink: 'Tea' } })}
    />
  ), settled)
  try {
    expect(settled.querySelector('select')).toBeNull()
    expect(settled.textContent).toContain('Tea')
    // Collapsed until asked for, and the option that was passed over is behind it.
    expect(settled.textContent).not.toContain('Coffee')
    const fold = settled.querySelector('details')!
    fold.open = true
    fold.dispatchEvent(new Event('toggle'))
    expect(settled.textContent).toContain('Coffee')
  } finally { disposeSettled() }
})

it('closes a turn with the context window on the right of the line', () => {
  const item: AgentConversationItem = {
    key: 'done', firstSeq: 9, lastSeq: 9, createdAt: 9, turnId: 'turn-1',
    event: { type: 'turn_completed', stopReason: 'end_turn' },
    context: { used: 94_358, size: 1_000_000 },
  }
  const host = document.createElement('div')
  const dispose = render(() => <AgentEventCard item={item} taskId="task" sessionId="session" />, host)
  try {
    // One row, the reason first and the figure last, which is what `Inline spread` puts at each end.
    const row = host.querySelector('.ui-inline[data-spread]')
    expect(row?.textContent).toBe('Turn complete · end_turn94,358 / 1,000,000 context')
  } finally { dispose() }
})

it('closes a turn that reported no context with the reason alone', () => {
  const item: AgentConversationItem = {
    key: 'done', firstSeq: 9, lastSeq: 9, createdAt: 9, turnId: 'turn-1',
    event: { type: 'turn_completed', stopReason: 'end_turn' },
  }
  const host = document.createElement('div')
  const dispose = render(() => <AgentEventCard item={item} taskId="task" sessionId="session" />, host)
  try {
    expect(host.textContent).toBe('Turn complete · end_turn')
  } finally { dispose() }
})

it('says in words that the model declined a refused turn', () => {
  const item: AgentConversationItem = {
    key: 'done', firstSeq: 9, lastSeq: 9, createdAt: 9, turnId: 'turn-1',
    event: { type: 'turn_completed', stopReason: 'refusal' },
  }
  const host = document.createElement('div')
  const dispose = render(() => <AgentEventCard item={item} taskId="task" sessionId="session" />, host)
  try {
    expect(host.querySelector('[data-tone="warn"]')?.textContent).toContain('The model declined this request.')
    expect(host.textContent).toContain('Turn complete · refusal')
  } finally { dispose() }
})
