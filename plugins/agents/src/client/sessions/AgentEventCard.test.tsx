import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
const openPane = vi.fn()
vi.mock('@acorn/plugin-api/client', async (original) => ({ ...await original<Record<string, unknown>>(), dispatchLayout, openPane }))

const { default: AgentEventCard } = await import('./AgentEventCard')
const { registerContextMenuItems } = await import('@acorn/plugin-api/client')
const { withoutAttachmentPlaceholders, withoutPastedMarkers } = await import('./messageText')
const { buildConversationItems, visibleConversationItems } = await import('./conversationItems')

const fileChange = (event: Extract<AgentConversationItem['event'], { type: 'file_change' }>): AgentConversationItem =>
  ({ key: 'change', firstSeq: 1, lastSeq: 1, createdAt: 1, turnId: 'turn-1', event })

const drawCard = (item: AgentConversationItem, turn?: AgentTurn) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <AgentEventCard item={item} taskId="task" sessionId="session" turn={turn} />, host)
  return { host, dispose: () => { dispose(); host.remove() } }
}

it('draws saved host verdicts on the delegation report card', () => {
  const item: AgentConversationItem = {
    key: 'report', firstSeq: 1, lastSeq: 1, createdAt: 1, turnId: 'report',
    event: { type: 'user_message', text: 'Child finished.\n\nFinal message: done' },
  }
  const turn = {
    source: 'delegation_report',
    input: [{ type: 'text', text: 'Child finished.' }],
    effectivePolicy: { checkResults: { checkedAt: Date.parse('2026-10-08T00:00:00Z'), verdicts: [
      { check: { kind: 'file-exists', path: 'output.txt' }, status: 'holds', reason: 'Regular file exists.' },
      { check: { kind: 'commits-ahead' }, status: 'fails', reason: 'No commits ahead of spawn base.' },
    ] } },
  } as unknown as AgentTurn
  const { host, dispose } = drawCard(item, turn)
  try {
    expect(host.textContent).toContain('Host checks')
    expect(host.textContent).toContain('holds: file-exists · output.txt · Regular file exists.')
    expect(host.textContent).toContain('fails: commits-ahead · No commits ahead of spawn base.')
  } finally { dispose() }
})

const openInChanges = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].find((element) => element.textContent?.includes('Open in Changes'))

it('opens a file change in place to show that step’s diff, and keeps the way to Changes', () => {
  dispatchLayout.mockClear(); openPane.mockClear()
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
    expect(openPane).toHaveBeenCalledWith('task', 'git', { kind: 'plugin:select', item: 'changes' })
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
  dispatchLayout.mockClear(); openPane.mockClear()
  const { host, dispose } = drawCard(fileChange({ type: 'file_change', summary: 'Codex updated files.' }))
  try {
    expect(host.querySelector('details')).toBeNull()
    expect(host.textContent).toContain('Changed files')
    host.querySelector<HTMLElement>('[role="button"], button')!.click()
    expect(openPane).toHaveBeenCalledWith('task', 'git', { kind: 'plugin:select', item: 'changes' })
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
    expect(handled.textContent).toContain('1. Update the API')
    expect(handled.textContent).not.toContain('Ready to code?')
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

// A permission a policy plugin refused before anyone saw it. Resolved permissions usually leave the
// thread, but this one is the only record that the agent asked, so it stays and names who said no.
it('keeps a refused permission in the thread and names the plugin that refused it', () => {
  const blocked: AgentConversationItem = {
    key: 'refused', firstSeq: 1, lastSeq: 1, createdAt: 1, turnId: 'turn-1',
    event: {
      type: 'request', requestId: 'perm-1', kind: 'permission', title: 'Allow command?',
      options: [{ id: 'decline', label: 'Reject', kind: 'reject_once' }],
      blocked: { by: 'acorn-permission-policy', reason: 'Force-pushing rewrites shared history.' },
    },
  }
  const row = {
    ...requestRow('resolved', { blocked: { by: 'acorn-permission-policy', reason: 'Force-pushing rewrites shared history.' } }),
    providerRequestId: 'perm-1', kind: 'permission' as const, title: 'Allow command?',
  }
  expect(visibleConversationItems([blocked], () => row)).toEqual([blocked])
  const host = document.createElement('div')
  const dispose = render(() => <AgentEventCard item={blocked} taskId="task" sessionId="session" request={row} />, host)
  try {
    expect(host.textContent).toContain('Blocked by acorn-permission-policy')
    expect(host.textContent).toContain('Force-pushing rewrites shared history.')
    expect(host.textContent).not.toContain('No answer')
    expect(host.querySelector('button')).toBeNull()
  } finally { dispose() }
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

describe('other plugins’ rows on a message and a turn', () => {
  const menuScope = { nodeId: 'node-a', projectId: 'project-1' }
  const turnRow = (over: Partial<AgentTurn> = {}) => ({ id: 'turn-1', status: 'completed', input: [], ...over }) as unknown as AgentTurn
  const said = (type: 'user_message' | 'assistant_message', text: string, lastSeq = 3): AgentConversationItem =>
    ({ key: `${type}-card`, firstSeq: 1, lastSeq, createdAt: 1, turnId: 'turn-1', event: { type, text } })
  const closing: AgentConversationItem = {
    key: 'closing', firstSeq: 9, lastSeq: 9, createdAt: 9, turnId: 'turn-1', event: { type: 'turn_completed', stopReason: 'end_turn' },
  }
  const registered: { dispose(): void }[] = []
  afterEach(() => { while (registered.length) registered.pop()!.dispose(); document.body.replaceChildren() })

  const draw = (initial: { item: AgentConversationItem; turn?: AgentTurn; sessionId?: string }) => {
    const [item, setItem] = createSignal(initial.item)
    const [turn, setTurn] = createSignal(initial.turn)
    const [sessionId, setSessionId] = createSignal(initial.sessionId ?? 'session')
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => (
      <AgentEventCard item={item()} taskId="task" sessionId={sessionId()} turn={turn()} menuScope={menuScope} />
    ), host)
    registered.push({ dispose })
    return { host, setItem, setTurn, setSessionId }
  }
  const trigger = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.ui-menu .ui-menu-item')]
  const row = (label: string) => rows().find((item) => item.textContent?.trim() === label)!

  it('adds the rows after all three Copy formats in the one menu, and says the menu does more', () => {
    const fileNote = vi.fn()
    registered.push(registerContextMenuItems([{ id: 'note', location: 'agent.message', label: 'File as note', order: 0, run: fileNote }]))
    const { host } = draw({ item: said('assistant_message', 'The fix is **here**.'), turn: turnRow() })
    expect(host.querySelectorAll('button[aria-haspopup="menu"]')).toHaveLength(1)
    expect(trigger(host)!.getAttribute('aria-label')).toBe('Copy this response or act on it')
    trigger(host)!.click()
    expect(rows().map((item) => item.textContent?.trim())).toEqual(['Copy as text', 'Copy as Markdown', 'Copy as JSON', 'File as note'])
    // Lined up with the Copy rows: a row with no icon reserves no icon slot.
    expect(row('File as note').querySelector('.ui-menu-leading')).toBeNull()
    row('File as note').click()
    expect(fileNote).toHaveBeenCalledWith({
      location: 'agent.message', nodeId: 'node-a', taskId: 'task', projectId: 'project-1', sessionId: 'session',
      itemId: 'assistant_message-card', turnId: 'turn-1', role: 'assistant', status: 'completed', text: 'The fix is **here**.', revision: 3,
    })
  })

  it('keeps the Copy menu as it was with no rows, and gives the reader’s message none at all', () => {
    const response = draw({ item: said('assistant_message', 'Done.'), turn: turnRow() })
    expect(trigger(response.host)!.getAttribute('aria-label')).toBe('Copy this response')
    const message = draw({ item: said('user_message', 'Fix it.'), turn: turnRow() })
    expect(trigger(message.host)).toBeNull()
  })

  it('matches a row on role, so a user-only row puts the menu on the reader’s message alone', () => {
    const quote = vi.fn()
    registered.push(registerContextMenuItems([{
      id: 'quote', location: 'agent.message', label: 'Quote', order: 0, when: (target) => target.role === 'user', run: quote,
    }]))
    const response = draw({ item: said('assistant_message', 'Done.'), turn: turnRow() })
    expect(trigger(response.host)!.getAttribute('aria-label')).toBe('Copy this response')
    const message = draw({
      item: said('user_message', 'Look\n\n[Attachment: a1]'),
      turn: turnRow({ input: [{ type: 'attachment', attachmentId: 'a1' }] }),
    })
    expect(trigger(message.host)!.getAttribute('aria-label')).toBe('Copy this message or act on it')
    trigger(message.host)!.click()
    row('Quote').click()
    expect(quote.mock.calls[0]![0]).toMatchObject({ role: 'user', text: 'Look' })
  })

  it('offers a turn’s menu on its closing line only once the turn has finished', () => {
    const review = vi.fn()
    registered.push(registerContextMenuItems([{ id: 'review', location: 'agent.turn', label: 'Review turn', order: 0, run: review }]))
    const { host, setTurn } = draw({ item: closing, turn: turnRow({ status: 'active' }) })
    expect(trigger(host)).toBeNull()
    setTurn(turnRow({ status: 'failed' }))
    expect(trigger(host)!.getAttribute('aria-label')).toBe('Actions for this turn')
    trigger(host)!.click()
    expect(rows().map((item) => item.textContent?.trim())).toEqual(['Review turn'])
    row('Review turn').click()
    expect(review).toHaveBeenCalledWith({
      location: 'agent.turn', nodeId: 'node-a', taskId: 'task', projectId: 'project-1', sessionId: 'session',
      turnId: 'turn-1', status: 'failed', revision: 9,
    })
  })

  it('refuses a row once the message streamed on, its turn changed, or the card shows another session', () => {
    const fileNote = vi.fn()
    registered.push(registerContextMenuItems([{ id: 'note', location: 'agent.message', label: 'File as note', order: 0, run: fileNote }]))
    const { host, setItem, setTurn, setSessionId } = draw({ item: said('assistant_message', 'Part', 3), turn: turnRow({ status: 'active' }) })
    trigger(host)!.click()
    setItem(said('assistant_message', 'Part one', 4))
    row('File as note').click()

    trigger(host)!.click()
    setTurn(turnRow({ status: 'completed' }))
    row('File as note').click()

    trigger(host)!.click()
    setSessionId('another-session')
    row('File as note').click()
    expect(fileNote).not.toHaveBeenCalled()

    // Opened again on what is there now, it runs.
    trigger(host)!.click()
    row('File as note').click()
    expect(fileNote).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'another-session', text: 'Part one', revision: 4 }))
  })

  it('keeps the transcript usable when a row throws', () => {
    const copied = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText: copied } })
    registered.push(registerContextMenuItems([{ id: 'broken', location: 'agent.message', label: 'Broken', order: 0, run: () => { throw new Error('boom') } }]))
    const { host } = draw({ item: said('assistant_message', 'Done.'), turn: turnRow() })
    trigger(host)!.click()
    expect(() => row('Broken').click()).not.toThrow()
    trigger(host)!.click()
    row('Copy as Markdown').click()
    expect(copied).toHaveBeenCalledWith('Done.')
    expect(host.textContent).toContain('Done.')
  })
})

describe('other plugins’ actions on text selected in a message', () => {
  const menuScope = { nodeId: 'node-a', projectId: 'project-1' }
  const turn = { id: 'turn-1', status: 'completed', input: [] } as unknown as AgentTurn
  const said = (type: 'user_message' | 'assistant_message', text: string, lastSeq = 3): AgentConversationItem =>
    ({ key: `${type}-card`, firstSeq: 1, lastSeq, createdAt: 1, turnId: 'turn-1', event: { type, text } })
  const registered: { dispose(): void }[] = []
  afterEach(() => {
    while (registered.length) registered.pop()!.dispose()
    document.getSelection()?.removeAllRanges()
    document.body.replaceChildren()
  })

  const draw = (initial: AgentConversationItem, scope: typeof menuScope | null = menuScope) => {
    const [item, setItem] = createSignal(initial)
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => <AgentEventCard item={item()} taskId="task" sessionId="session" turn={turn} menuScope={scope ?? undefined} />, host)
    registered.push({ dispose })
    return { host, setItem }
  }
  // The mocked Markdown draws the text in one span, so select a word of it and right-click there.
  const selectAndRightClick = (host: HTMLElement, text: string, word: string) => {
    const node = [...host.querySelectorAll('span')].find((span) => span.textContent === text)!.firstChild!
    const range = document.createRange()
    range.setStart(node, text.indexOf(word))
    range.setEnd(node, text.indexOf(word) + word.length)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    node.parentElement!.dispatchEvent(event)
    return event
  }
  const row = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.ui-menu .ui-menu-item')]
    .find((item) => item.textContent?.trim() === label)
  const explain = () => {
    const run = vi.fn()
    registered.push(registerContextMenuItems([{ id: 'explain', location: 'content.selection', label: 'Explain', order: 0, run }]))
    return run
  }

  it('hands a row the selected words with the message’s identity and revision', () => {
    const run = explain()
    const { host } = draw(said('assistant_message', 'The fix is in parser.ts today'))
    expect(selectAndRightClick(host, 'The fix is in parser.ts today', 'parser.ts').defaultPrevented).toBe(true)
    row('Explain')!.click()
    expect(run).toHaveBeenCalledWith({
      location: 'content.selection', nodeId: 'node-a', taskId: 'task', projectId: 'project-1', ownerId: 'agents',
      contentKind: 'markdown', readOnly: true, text: 'parser.ts', revision: 3,
      resource: { kind: 'message', sessionId: 'session', itemId: 'assistant_message-card' },
    })
  })

  it('does the same on the reader’s own message', () => {
    const run = explain()
    const { host } = draw(said('user_message', 'Please fix the parser'))
    selectAndRightClick(host, 'Please fix the parser', 'parser')
    row('Explain')!.click()
    expect(run.mock.calls[0]![0]).toMatchObject({ text: 'parser', resource: { itemId: 'user_message-card' } })
  })

  it('refuses a row once the message streamed on while the menu was open', () => {
    const run = explain()
    const { host, setItem } = draw(said('assistant_message', 'Partial answer', 3))
    selectAndRightClick(host, 'Partial answer', 'Partial')
    setItem(said('assistant_message', 'Partial answer', 4))
    row('Explain')!.click()
    expect(run).not.toHaveBeenCalled()
  })

  it('offers nothing in a transcript with no bound Node and project', () => {
    explain()
    const { host } = draw(said('assistant_message', 'Unbound text'), null)
    expect(selectAndRightClick(host, 'Unbound text', 'Unbound').defaultPrevented).toBe(false)
    expect(row('Explain')).toBeUndefined()
  })
})
