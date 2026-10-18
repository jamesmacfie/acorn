import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import type {
  BridgeAgentRequest,
  BridgeAgentSession,
  BridgeConversationRecord,
  BridgeInputPart,
} from '@acorn/protocol/extensionBridge.ts'
import { SELECTED_NODE_KEY, startBackground } from '../background/background'
import { fakeBrowser, settle, type FakeHost } from '../test/fakeBrowser'
import {
  back,
  button,
  chatRows,
  conversationTitle,
  openChat,
  openTask,
  shownTask,
  tab,
  tabMarker,
  taskTabs,
} from '../test/sidebarUi'
import { reportResize } from '../test/sidebarSetup'
import { App } from './App'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

type Request = Record<string, unknown> & { id: string; op: string }
type Answer = { result: unknown } | { error: { code: string; message: string } }

const session = (id: string, extra: Partial<BridgeAgentSession> = {}): BridgeAgentSession => ({
  id,
  taskId: 't1',
  title: `Chat ${id}`,
  providerId: 'claude',
  profileId: 'claude-code',
  model: null,
  kind: 'interactive',
  inline: false,
  runtimeState: 'ready',
  attention: 'none',
  lastEventSeq: 0,
  archivedAt: null,
  updatedAt: 1,
  ...extra,
})

// One Node with one project and one task, whose sessions and events the test edits. A test can hold
// any operation's answer with `holds`, or replace it with `answers`.
function node() {
  const state = {
    sessions: [session('s1'), session('s2')] as BridgeAgentSession[],
    events: new Map<string, BridgeConversationRecord[]>([
      ['s1', []],
      ['s2', []],
    ]),
    requests: [] as Request[],
    // The agent's requests as the Node holds them, and each answer the Node took, by key.
    agentRequests: [] as (BridgeAgentRequest & { sessionId: string })[],
    resolutions: new Map<string, unknown>(),
    turns: new Map<string, string>(),
    inputs: new Map<string, BridgeInputPart[]>(),
    // Uploads keyed by content, as the Node keeps one attachment per task and content.
    uploads: new Map<string, string>(),
    deleted: [] as string[],
    holds: new Map<string, (answer: () => void) => void>(),
    answers: new Map<string, (request: Request) => Answer | undefined>(),
    host: null as FakeHost | null,
  }
  const say = (sessionId: string, text: string, kind: 'user_message' | 'assistant_message' = 'assistant_message') => {
    const events = state.events.get(sessionId)!
    const seq = (events.at(-1)?.seq ?? 0) + 1
    events.push({ id: `${sessionId}-e${seq}`, seq, turnId: null, createdAt: seq, event: { type: kind, text } })
    const row = state.sessions.find((candidate) => candidate.id === sessionId)!
    row.lastEventSeq = seq
  }
  const answer = (request: Request): Answer => {
    const nodes = {
      nodes: [{ nodeId: 'n1', label: 'Studio', endpoint: 'https://n1.test', local: false }],
      activeNodeId: 'n1',
      status: { nodeId: 'n1', state: 'online' },
    }
    switch (request.op) {
      case 'nodes.list':
      case 'node.select':
        return { result: nodes }
      case 'projects.list':
        return {
          result: {
            nodeId: 'n1',
            projects: [{ id: 'p1', name: 'Acorn', path: null, hidden: false, workspaceId: 'w1' }],
            workspaces: [{ id: 'w1', name: 'Main' }],
          },
        }
      case 'tasks.pages':
        return {
          result: { nodeId: 'n1', tasks: [{ id: 't1', title: 'Fix it', branch: null, projectId: 'p1', pages: [] }] },
        }
      // The test page is on the project's site, so Home lists the current task's conversations.
      case 'sites.list':
        return {
          result: { nodeId: 'n1', sites: [{ projectId: 'p1', origin: 'https://example.test', pathPrefix: '/' }] },
        }
      case 'sessions.list':
        return { result: { nodeId: 'n1', taskId: 't1', sessions: state.sessions.map((row) => ({ ...row })) } }
      case 'session.read': {
        const id = request.sessionId as string
        const row = state.sessions.find((candidate) => candidate.id === id)
        if (!row) return { error: { code: 'not_found', message: 'Not found.' } }
        const records = state.events.get(id)!.filter((event) => event.seq > (request.afterSeq as number))
        return {
          result: {
            nodeId: 'n1',
            sessionId: id,
            session: { ...row },
            records,
            reach: records.at(-1)?.seq ?? request.afterSeq,
            queued: [],
            requests: state.agentRequests.filter((row) => row.sessionId === id).map(({ sessionId: _, ...row }) => row),
          },
        }
      }
      case 'turn.submit': {
        const key = request.key as string
        const input = request.input as BridgeInputPart[]
        const text = input.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
        if (!state.turns.has(key)) {
          state.turns.set(key, text)
          state.inputs.set(key, input)
          say(request.sessionId as string, text, 'user_message')
        }
        return { result: { nodeId: 'n1', sessionId: request.sessionId, turnId: `turn-${key}` } }
      }
      case 'request.resolve': {
        // As the agents runtime does: one answer settles a request, and a settled one answers as it is.
        const row = state.agentRequests.find(
          (candidate) => candidate.sessionId === request.sessionId && candidate.requestId === request.requestId,
        )
        if (!row) return { error: { code: 'not_found', message: 'Agent request not found.' } }
        if (row.status === 'pending') {
          const resolution = request.resolution as { optionId?: string }
          row.status = 'resolved'
          row.answer = row.options.find((option) => option.id === resolution.optionId)?.label ?? null
          state.resolutions.set(request.key as string, request.resolution)
        }
        const { sessionId: _, ...result } = row
        return { result: { nodeId: 'n1', sessionId: request.sessionId, request: result } }
      }
      case 'requests.pending':
        return {
          result: {
            nodeId: 'n1',
            requests: state.agentRequests
              .filter((row) => row.status === 'pending')
              .map((row) => ({
                requestId: row.requestId,
                sessionId: row.sessionId,
                taskId: 't1',
                projectId: 'p1',
                kind: row.kind,
                title: row.title,
                taskTitle: 'Fix it',
              })),
          },
        }
      case 'agents.choices':
        return {
          result: {
            nodeId: 'n1',
            choices: [
              {
                providerId: 'codex',
                profileId: 'codex',
                customAgentId: null,
                account: null,
                label: 'Codex',
                text: 'Codex',
                description: 'codex not found',
                glyph: null,
                accountIcon: null,
                available: false,
              },
              {
                providerId: 'claude',
                profileId: 'claude-code',
                customAgentId: null,
                account: null,
                label: 'Claude Code',
                text: 'Claude Code',
                description: 'Available',
                glyph: 'brand:agents/claude',
                accountIcon: null,
                available: true,
              },
              {
                providerId: 'claude',
                profileId: 'claude-code',
                customAgentId: 'reviewer',
                account: null,
                label: 'Reviewer',
                text: 'Reviewer',
                description: 'Claude Code · opus',
                glyph: 'rocket',
                accountIcon: null,
                available: true,
              },
            ],
          },
        }
      case 'session.create': {
        const created = session('s3', { title: 'New chat' })
        if (!state.sessions.some((row) => row.id === 's3')) {
          state.sessions.unshift(created)
          state.events.set('s3', [])
        }
        return { result: { nodeId: 'n1', session: created } }
      }
      case 'attachment.upload': {
        const data = request.data as string
        if (!state.uploads.has(data)) state.uploads.set(data, `att-${state.uploads.size + 1}`)
        const id = state.uploads.get(data)!
        const attachment = {
          id,
          taskId: request.taskId,
          filename: request.filename,
          mediaType: request.mediaType,
          byteSize: 4,
        }
        return { result: { nodeId: 'n1', taskId: request.taskId, attachment } }
      }
      case 'session.cancel': {
        // As the agents runtime does once the stop lands: the turn ends and the session rests.
        state.sessions.find((row) => row.id === request.sessionId)!.runtimeState = 'ready'
        return { result: { nodeId: 'n1', sessionId: request.sessionId } }
      }
      case 'attachment.delete':
        state.deleted.push(request.attachmentId as string)
        return { result: { nodeId: 'n1', taskId: request.taskId, attachmentId: request.attachmentId, removed: true } }
      default:
        return { error: { code: 'bad_request', message: request.op } }
    }
  }
  return { state, say, answer }
}

function mount(fake = fakeBrowser(), subject = node()) {
  fake.onNativeConnect = (host) => (subject.state.host = host)
  fake.onNativeMessage = (raw, host) => {
    const request = raw as Request
    subject.state.requests.push(request)
    const reply = () => {
      const scripted = subject.state.answers.get(request.op)?.(request)
      const answer = scripted ?? subject.answer(request)
      host.send(
        'result' in answer
          ? { v: 1, id: request.id, ok: true, result: answer.result }
          : { v: 1, id: request.id, ok: false, error: answer.error },
      )
    }
    const hold = subject.state.holds.get(request.op)
    if (hold) hold(reply)
    else reply()
  }
  startBackground(fake.api, 'com.acorn.browser_bridge')
  const open = () => {
    dispose?.()
    document.body.innerHTML = ''
    const root = document.createElement('div')
    document.body.append(root)
    dispose = render(() => <App api={fake.api} />, root)
    return root
  }
  return { fake, ...subject, root: open(), reopen: open }
}

const choose = (root: HTMLElement, name: string, value: string) => {
  const select = root.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}
const type = (root: HTMLElement, value: string) => {
  const box = root.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!
  box.value = value
  box.dispatchEvent(new Event('input', { bubbles: true }))
}
const send = (root: HTMLElement) =>
  root
    .querySelector('[aria-label="Conversation"] form.composer')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
// Each item's text: a card's speaker and then its content, without the time, or a tool line's text.
const transcript = (root: HTMLElement) =>
  [...root.querySelectorAll('.transcript > li')].map((item) => {
    const card = item.querySelector('.ui-card > .ui-stack')
    if (!card) return item.textContent
    const [eyebrow, ...content] = [...card.children]
    return eyebrow!.firstElementChild!.textContent + content.map((part) => part.textContent).join('')
  })
const draft = (root: HTMLElement) => root.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.value

async function openSession(subject: ReturnType<typeof mount>, sessionId = 's1') {
  await settle()
  await openTask(subject.root, 'Fix it')
  await openChat(subject.root, `Chat ${sessionId}`)
}
// The conversation's own reads, apart from the short ones Home makes for each row's last line.
const windowReads = (requests: Request[]) =>
  requests.filter((request) => request.op === 'session.read' && request.limit === 200)

describe('conversation', () => {
  it('shows the conversation, and reads on from its end when a hint names it', async () => {
    const subject = mount()
    subject.say('s1', 'Hello from the desktop', 'user_message')
    subject.say('s1', 'Hi')
    await openSession(subject)
    // Where a message goes: the conversation, under its task, in the top bar.
    expect(subject.root.querySelector('header .eyebrow')!.textContent).toBe('Fix it')
    expect(conversationTitle(subject.root)).toBe('Chat s1')
    expect(transcript(subject.root)).toEqual(['YouHello from the desktop', 'ClaudeHi'])

    subject.say('s1', 'A reply another client caused')
    subject.state.host!.send({ v: 1, event: 'agent', nodeId: 'n1', sessions: ['s1'], tasks: [], missed: false })
    await settle()
    const reads = windowReads(subject.state.requests)
    expect(reads.map((request) => request.afterSeq)).toEqual([0, 2])
    expect(transcript(subject.root)).toEqual([
      'YouHello from the desktop',
      'ClaudeHi',
      'ClaudeA reply another client caused',
    ])
  })

  it('opens on the newest message and follows new ones until the reader scrolls up', async () => {
    // jsdom lays nothing out, so the page's heights are set by hand as the transcript grows.
    const page = document.scrollingElement ?? document.documentElement
    const grow = (height: number) => {
      Object.defineProperty(page, 'scrollHeight', { configurable: true, value: height })
      reportResize()
    }
    const scrollTo = (top: number) => {
      page.scrollTop = top
      dispatchEvent(new Event('scroll'))
    }
    Object.defineProperty(page, 'clientHeight', { configurable: true, value: 500 })
    const subject = mount()
    scrollTo(0)
    await openSession(subject)
    grow(2000)
    expect(page.scrollTop).toBe(2000)
    // Reading history stops the following.
    scrollTo(300)
    grow(2600)
    expect(page.scrollTop).toBe(300)
    // Back at the bottom, within a little slack, it follows again.
    scrollTo(2080)
    grow(3000)
    expect(page.scrollTop).toBe(3000)
    delete (page as { scrollHeight?: number }).scrollHeight
    delete (page as { clientHeight?: number }).clientHeight
  })

  it('renders messages as Markdown and a tool call as a state mark', async () => {
    const subject = mount()
    subject.say('s1', 'Run **the** tests')
    const tool = (seq: number, status: string) =>
      subject.state.events.get('s1')!.push({
        id: `s1-t${seq}`,
        seq,
        turnId: 'turn',
        createdAt: seq,
        event: { type: 'tool', toolId: `tool-${seq}`, title: `pnpm test ${seq}`, status },
      })
    tool(2, 'completed')
    tool(3, 'running')
    subject.state.sessions[0]!.lastEventSeq = 3
    await openSession(subject)
    const agent = subject.root.querySelector('.transcript .ui-card[data-stripe="ok"]')!
    expect(agent.querySelector('.ui-text[data-emphasis="eyebrow"]')!.textContent).toBe('Claude')
    expect(agent.querySelector('.ui-markdown strong')!.textContent).toBe('the')
    // A finished call is its mark alone; any other state is written beside it.
    expect(transcript(subject.root).slice(1)).toEqual(['pnpm test 2', 'pnpm test 3 · running'])
    const marks = [...subject.root.querySelectorAll('.transcript li.tool > .ui-icon')]
    expect(
      marks.map((mark) => [
        mark.getAttribute('data-tone'),
        mark.getAttribute('aria-label'),
        mark.hasAttribute('data-spin'),
      ]),
    ).toEqual([
      ['ok', 'completed', false],
      ['accent', 'running', true],
    ])
  })

  describe('a run of tool calls', () => {
    const tool = (subject: ReturnType<typeof mount>, seq: number, status = 'completed') => {
      subject.state.events.get('s1')!.push({
        id: `s1-t${seq}`,
        seq,
        turnId: 'turn',
        createdAt: seq,
        event: { type: 'tool', toolId: `tool-${seq}`, title: `Step ${seq}`, status },
      })
      subject.state.sessions[0]!.lastEventSeq = seq
    }
    const fold = (root: HTMLElement) => root.querySelector<HTMLDetailsElement>('.transcript details.ui-fold')
    const toggle = async (root: HTMLElement) => {
      fold(root)!.querySelector('summary')!.click()
      await settle()
    }
    // The lines a reader sees: none inside a closed fold.
    const lines = (root: HTMLElement) =>
      [...root.querySelectorAll('.transcript li.tool')].filter((line) => !line.closest('details:not([open])'))

    it('folds four calls into one line, and opening it shows all four', async () => {
      const subject = mount()
      for (const seq of [1, 2, 3, 4]) tool(subject, seq)
      await openSession(subject)
      expect(fold(subject.root)!.open).toBe(false)
      expect(fold(subject.root)!.querySelector('summary')!.textContent).toBe('4 tool calls')
      expect(lines(subject.root)).toEqual([])
      await toggle(subject.root)
      expect(fold(subject.root)!.open).toBe(true)
      expect(lines(subject.root).map((line) => line.textContent)).toEqual(['Step 1', 'Step 2', 'Step 3', 'Step 4'])
    })

    it('keeps a failed call in view under the closed fold, and counts it', async () => {
      const subject = mount()
      for (const seq of [1, 2, 3]) tool(subject, seq, seq === 2 ? 'failed' : 'completed')
      await openSession(subject)
      expect(fold(subject.root)!.querySelector('summary')!.textContent).toBe('3 tool calls· 1 failed')
      expect(lines(subject.root).map((line) => line.textContent)).toEqual(['Step 2 · failed'])
      const mark = lines(subject.root)[0]!.querySelector('.ui-icon')!
      expect([mark.getAttribute('data-tone'), mark.getAttribute('aria-label')]).toEqual(['danger', 'failed'])
      await toggle(subject.root)
      expect(lines(subject.root)).toHaveLength(3)
    })

    it('keeps the fold as it was while the run grows, and after leaving the conversation', async () => {
      const subject = mount()
      for (const seq of [1, 2, 3]) tool(subject, seq, seq === 3 ? 'running' : 'completed')
      await openSession(subject)
      tool(subject, 4)
      subject.state.host!.send({ v: 1, event: 'agent', nodeId: 'n1', sessions: ['s1'], tasks: [], missed: false })
      await settle()
      expect(fold(subject.root)!.querySelector('summary')!.textContent).toBe('4 tool calls')
      expect(fold(subject.root)!.open).toBe(false)
      await toggle(subject.root)
      tool(subject, 5)
      subject.state.host!.send({ v: 1, event: 'agent', nodeId: 'n1', sessions: ['s1'], tasks: [], missed: false })
      await settle()
      expect(subject.root.querySelectorAll('.transcript details.ui-fold')).toHaveLength(1)
      expect(fold(subject.root)!.open).toBe(true)
      expect(lines(subject.root)).toHaveLength(5)
      await back(subject.root)
      await openChat(subject.root, 'Chat s1')
      expect(fold(subject.root)!.open).toBe(true)
    })

    it('never folds two calls', async () => {
      const subject = mount()
      for (const seq of [1, 2]) tool(subject, seq)
      await openSession(subject)
      expect(fold(subject.root)).toBeNull()
      expect(transcript(subject.root)).toEqual(['Step 1', 'Step 2'])
    })
  })

  describe('the state line', () => {
    const activity = (root: HTMLElement) => root.querySelector('.composer .activity')?.textContent ?? null

    it('says the agent is working, and Stop stops it', async () => {
      const subject = mount()
      subject.state.sessions[0]!.runtimeState = 'working'
      await openSession(subject)
      expect(activity(subject.root)).toBe('WorkingStop')
      button(subject.root, 'Stop')!.click()
      await settle()
      expect(subject.state.requests.find((request) => request.op === 'session.cancel')).toMatchObject({
        nodeId: 'n1',
        sessionId: 's1',
        key: expect.any(String),
      })
      expect(activity(subject.root)).toBeNull()
    })

    it('says when the agent waits for you, and shows nothing at rest', async () => {
      const subject = mount()
      subject.state.sessions[0]!.runtimeState = 'waiting'
      await openSession(subject)
      expect(activity(subject.root)).toBe('Waiting for you')
      expect(button(subject.root, 'Stop')).toBeUndefined()
      subject.state.sessions[0]!.runtimeState = 'ready'
      subject.state.host!.send({ v: 1, event: 'agent', nodeId: 'n1', sessions: ['s1'], tasks: [], missed: false })
      await settle()
      expect(activity(subject.root)).toBeNull()
    })

    it('says why a stop failed', async () => {
      const subject = mount()
      subject.state.sessions[0]!.runtimeState = 'working'
      subject.state.answers.set('session.cancel', () => ({
        error: { code: 'node_error', message: 'No turn to stop.' },
      }))
      await openSession(subject)
      button(subject.root, 'Stop')!.click()
      await settle()
      expect(subject.root.querySelector('.composer .problem[role="alert"]')).toBeTruthy()
      expect(activity(subject.root)).toBe('WorkingStop')
    })
  })

  it('keeps an unsent draft and the destination when the sidebar closes and opens again', async () => {
    const subject = mount()
    await openSession(subject)
    type(subject.root, 'Half a thought')
    await settle()
    const root = subject.reopen()
    await settle(20)
    expect(conversationTitle(root)).toBe('Chat s1')
    expect(draft(root)).toBe('Half a thought')
  })

  it('gives each conversation its own draft and drops a slow read for the one it left', async () => {
    const subject = mount()
    subject.say('s1', 'Only in s1')
    await openSession(subject)
    type(subject.root, 'For s1')
    await back(subject.root)
    // Open s1 again, but leave for s2 before its read answers.
    let slow!: () => void
    subject.state.holds.set('session.read', (answer) => (slow = answer))
    await openChat(subject.root, 'Chat s1')
    subject.state.holds.delete('session.read')
    await openChat(subject.root, 'Chat s2')
    slow()
    await settle()
    expect(conversationTitle(subject.root)).toBe('Chat s2')
    expect(transcript(subject.root)).toEqual([])
    expect(draft(subject.root)).toBe('')
    await openChat(subject.root, 'Chat s1')
    expect(transcript(subject.root)).toEqual(['ClaudeOnly in s1'])
    expect(draft(subject.root)).toBe('For s1')
  })

  it('keeps an unconfirmed message and retries it with the same key, making one turn', async () => {
    const subject = mount()
    await openSession(subject)
    type(subject.root, 'Run the tests')
    // The Node takes the turn but the answer is lost on the way back.
    subject.state.answers.set('turn.submit', (request) => {
      subject.answer(request)
      return { error: { code: 'ambiguous_mutation', message: 'The Node did not confirm the change.' } }
    })
    send(subject.root)
    await settle()
    expect(draft(subject.root)).toBe('Run the tests')
    expect(subject.root.textContent).toContain("didn't confirm this message")
    expect(transcript(subject.root)).toEqual(['YouRun the tests'])
    expect(button(subject.root, 'Retry')).toBeTruthy()

    subject.state.answers.delete('turn.submit')
    send(subject.root)
    await settle()
    const keys = subject.state.requests.filter((request) => request.op === 'turn.submit').map((request) => request.key)
    expect(new Set(keys).size).toBe(1)
    expect(subject.state.turns.size).toBe(1)
    expect(draft(subject.root)).toBe('')
    expect(transcript(subject.root)).toEqual(['YouRun the tests'])
  })

  it('sends to the conversation the message was written in, even after a switch', async () => {
    const subject = mount()
    await openSession(subject)
    type(subject.root, 'For s1 only')
    let release!: () => void
    subject.state.holds.set('turn.submit', (answer) => (release = answer))
    send(subject.root)
    await settle()
    subject.state.holds.delete('turn.submit')
    await openChat(subject.root, 'Chat s2')
    type(subject.root, 'Typed in s2')
    release()
    await settle()
    expect(subject.state.requests.find((request) => request.op === 'turn.submit')).toMatchObject({ sessionId: 's1' })
    expect(draft(subject.root)).toBe('Typed in s2')
    expect(subject.fake.storage.get('draft:n1:t1:s1')).toBeUndefined()
    await openChat(subject.root, 'Chat s1')
    expect(draft(subject.root)).toBe('')
    expect(transcript(subject.root)).toEqual(['YouFor s1 only'])
  })

  it('sends with Enter, adds a line with Shift-Enter, and toggles the box size with Command-Shift-Enter', async () => {
    const subject = mount()
    await openSession(subject)
    const box = subject.root.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!
    expect(box.placeholder).toBe('Ask the agent…')
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })
      box.dispatchEvent(event)
      return event
    }
    expect(box.rows).toBe(3)
    press({ metaKey: true, shiftKey: true })
    expect(box.rows).toBe(18)
    button(subject.root, 'Collapse the message box')!.click()
    expect(box.rows).toBe(3)
    type(subject.root, 'Ship it')
    // Shift-Enter is the field's own new line, and Enter ending a composition is the input method's.
    expect(press({ shiftKey: true }).defaultPrevented).toBe(false)
    expect(press({ isComposing: true }).defaultPrevented).toBe(false)
    await settle()
    expect(subject.state.turns.size).toBe(0)
    expect(press({}).defaultPrevented).toBe(true)
    await settle()
    expect(subject.state.turns.size).toBe(1)
    expect(draft(subject.root)).toBe('')
  })

  it('reads again when the Node comes back, and holds sends while it is away', async () => {
    const subject = mount()
    await openSession(subject)
    subject.state.host!.send({ v: 1, event: 'status', status: { nodeId: 'n1', state: 'offline' } })
    await settle()
    const box = subject.root.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!
    expect(box.placeholder).toBe('Offline. Your draft is kept.')
    type(subject.root, 'Wait for it')
    await settle()
    expect(button(subject.root, 'Send')!.hasAttribute('disabled')).toBe(true)
    expect(subject.root.querySelector('.composer .notice')!.textContent).toBe('Offline. Your draft is kept.')
    subject.say('s1', 'Said while you were away')
    subject.state.host!.send({ v: 1, event: 'status', status: { nodeId: 'n1', state: 'online' } })
    await settle()
    expect(transcript(subject.root)).toEqual(['ClaudeSaid while you were away'])
    expect(button(subject.root, 'Send')!.hasAttribute('disabled')).toBe(false)
  })

  it('keeps the draft of a conversation that is gone or archived and refuses to send', async () => {
    const subject = mount()
    await openSession(subject)
    type(subject.root, 'Still here')
    subject.state.sessions[0]!.archivedAt = 5
    subject.state.host!.send({ v: 1, event: 'agent', nodeId: 'n1', sessions: ['s1'], tasks: [], missed: false })
    await settle()
    expect(subject.root.textContent).toContain('This conversation is archived')
    expect(button(subject.root, 'Send')!.hasAttribute('disabled')).toBe(true)
    subject.state.sessions.shift()
    subject.state.host!.send({ v: 1, event: 'agent', nodeId: 'n1', sessions: ['s1'], tasks: [], missed: false })
    await settle()
    expect(subject.root.textContent).toContain('This conversation is no longer on the Node')
    expect(draft(subject.root)).toBe('Still here')
  })

  it("starts a chat from the desktop's New picker, custom agents included, and says why a row can't start", async () => {
    const subject = mount()
    await openSession(subject)
    await back(subject.root)
    // The kit Picker draws its list in a portal on the page's body.
    const rows = () => [...document.querySelectorAll<HTMLElement>('.repo-picker-row')]
    const row = (name: string) =>
      rows().find((each) => each.querySelector('.repo-picker-name > span')?.textContent === name)!
    const open = async () => {
      if (rows().length) return
      button(subject.root, 'New chat')!.click()
      await settle()
    }
    const pick = async (name: string) => {
      await open()
      row(name).querySelector('button')!.click()
      await settle()
    }
    await open()
    expect(
      rows().map((each) => [each.querySelector('button')!.textContent, each.classList.contains('disabled')]),
    ).toEqual([
      ['Codexcodex not found', true],
      ['Claude CodeAvailable', false],
      ['ReviewerClaude Code · opus', false],
    ])
    button(document.body, 'Refresh provider health')!.click()
    await settle()
    expect(subject.state.requests.filter((request) => request.op === 'agents.choices').at(-1)).toMatchObject({
      refresh: true,
    })

    subject.state.answers.set('session.create', () => ({ error: { code: 'ambiguous_mutation', message: 'lost' } }))
    await pick('Reviewer')
    expect(subject.root.textContent).toContain("didn't confirm the new chat")
    subject.state.answers.delete('session.create')
    await pick('Reviewer')
    const creates = subject.state.requests.filter((request) => request.op === 'session.create')
    expect(creates.map((request) => [request.providerId, request.customAgentId])).toEqual([
      ['claude', 'reviewer'],
      ['claude', 'reviewer'],
    ])
    expect(new Set(creates.map((request) => request.key)).size).toBe(1)
    expect(conversationTitle(subject.root)).toBe('New chat')
  })
})

describe('home', () => {
  // Each row's title, its provider and model line, its state icon's name, whether that icon turns, and
  // its trailing text.
  const rows = (root: HTMLElement) =>
    chatRows(root).map((row) => [
      row.querySelector('.row-title')!.textContent,
      row.querySelector('.row-meta')!.textContent,
      row.querySelector('.ui-row-leading [role="img"]')!.getAttribute('aria-label'),
      row.querySelector('.ui-row-leading [data-spin]') !== null,
      row.querySelector('.ui-row-trailing')!.textContent,
    ])
  it("lists the task's conversations as the desktop does, and goes back from one", async () => {
    const subject = mount()
    subject.state.sessions[0]!.model = 'Opus · High'
    subject.state.sessions[0]!.updatedAt = Date.now() - 2 * 60_000
    subject.state.sessions[1]!.runtimeState = 'working'
    subject.state.sessions[1]!.updatedAt = Date.now()
    await settle()
    // The list is the task's, not Home's.
    expect(subject.root.querySelector('.view[aria-label="Agents"]')).toBeNull()
    await openTask(subject.root, 'Fix it')
    expect(shownTask(subject.root)).toBe('Fix it')
    // A Node without workflows has no Runs tab.
    expect(taskTabs(subject.root)).toEqual(['Agents'])
    // The icon says the state, so the line under the title doesn't. A provider with no logo is named.
    expect(rows(subject.root)).toEqual([
      ['Chat s1', 'claude · Opus · High', 'Ready', false, '2m ago'],
      ['Chat s2', 'claude', 'Working', true, 'now'],
    ])

    // A conversation waiting on the person leads with the alert and trails it, under the task's own
    // Needs you list, whose rows leave the task's title out.
    subject.state.agentRequests.push(permission())
    subject.state.host!.send({
      v: 1,
      event: 'agent',
      nodeId: 'n1',
      sessions: ['s1'],
      tasks: [],
      missed: false,
      requests: true,
    })
    await settle(20)
    expect(rows(subject.root)[0]).toEqual(['Chat s1', 'claude · Opus · High', 'Waiting for you', false, '2m ago'])
    expect(subject.root.querySelectorAll('.ui-row-trailing [data-tone="warn"]').length).toBe(1)
    const needsYou = subject.root.querySelector('.view[aria-label="Agents"] section[aria-label="Needs you"]')!
    expect(needsYou.querySelector('.row-meta')!.textContent).toBe('Chat s1')
    subject.state.agentRequests.length = 0

    await openChat(subject.root, 'Chat s1')
    expect(subject.root.querySelector('.view[aria-label="Agents"]')).toBeNull()
    expect(conversationTitle(subject.root)).toBe('Chat s1')
    expect(subject.root.querySelector('header .eyebrow')!.textContent).toBe('Fix it')
    await back(subject.root)
    expect(subject.root.querySelector('[aria-label="Conversation"]')).toBeNull()
    expect(shownTask(subject.root)).toBe('Fix it')
    expect(subject.root.querySelector('.view[aria-label="Agents"]')).not.toBeNull()
    expect(subject.fake.storage.get('destination:n1')).toEqual({ projectId: 'p1', taskId: 't1', sessionId: null })
  })

  it("marks the Agents tab with the task's working agents, or the ones waiting, counted under an open conversation too", async () => {
    const subject = mount()
    const marker = () => tabMarker(subject.root, 'Agents')
    subject.state.sessions[1]!.runtimeState = 'working'
    await settle()
    await openTask(subject.root, 'Fix it')
    expect(marker()).toBe('1 agent working')

    await openChat(subject.root, 'Chat s1')
    subject.state.sessions[1]!.runtimeState = 'ready'
    subject.state.host!.send({ v: 1, event: 'agent', nodeId: 'n1', sessions: ['s2'], tasks: [], missed: false })
    await settle(20)
    await back(subject.root)
    expect(marker()).toBeNull()
    await openChat(subject.root, 'Chat s1')

    subject.state.agentRequests.push(permission())
    subject.state.host!.send({
      v: 1,
      event: 'agent',
      nodeId: 'n1',
      sessions: ['s1'],
      tasks: [],
      missed: false,
      requests: true,
    })
    await settle(20)
    await back(subject.root)
    expect(marker()).toBe('1 agent needs you')
  })

  it('groups the conversations into managed sessions, then closed folds that stay as the person leaves them', async () => {
    const subject = mount()
    subject.state.sessions.push(session('s3', { kind: 'workflow' }), session('s4', { inline: true }))
    subject.state.events.set('s3', []).set('s4', [])
    await settle()
    await openTask(subject.root, 'Fix it')
    await tab(subject.root, 'Agents')
    const view = () => subject.root.querySelector<HTMLElement>('.view[aria-label="Agents"]')!
    const titles = () => chatRows(subject.root).map((row) => row.querySelector('.row-title')!.textContent)
    const folds = () =>
      [...view().querySelectorAll('details')].map((fold) => [
        fold.querySelector('.ui-section-header-label')!.textContent,
        fold.querySelector('.ui-section-header-count')!.textContent,
        fold.open,
      ])
    // New chat sits in the Managed sessions header.
    expect(button(view().querySelector('section[aria-label="Managed sessions"]')!, 'New chat')).toBeDefined()
    expect(titles()).toEqual(['Chat s1', 'Chat s2'])
    expect(folds()).toEqual([
      ['Workflow runs', '1', false],
      ['Inline chats', '1', false],
    ])

    view().querySelector<HTMLElement>('details summary')!.click()
    await settle(20)
    expect(titles()).toEqual(['Chat s1', 'Chat s2', 'Chat s3'])
    // The fold is still open after a conversation and back.
    await openChat(subject.root, 'Chat s3')
    await back(subject.root)
    expect(folds()).toEqual([
      ['Workflow runs', '1', true],
      ['Inline chats', '1', false],
    ])
  })

  it('offers to start the first chat in a task with none', async () => {
    const subject = mount()
    subject.state.sessions.length = 0
    await settle()
    await openTask(subject.root, 'Fix it')
    const view = subject.root.querySelector<HTMLElement>('.view[aria-label="Agents"]')!
    expect(view.querySelector('.ui-empty-title')!.textContent).toBe('No chats in this task')
    expect(view.querySelector('[aria-label="Pending item"]')).toBeNull()
    expect(button(view, 'Start a chat')).toBeDefined()
    expect(button(view, 'New chat')).toBeUndefined()
  })
})

describe('Needs you', () => {
  const hint = (subject: ReturnType<typeof mount>) =>
    subject.state.host!.send({
      v: 1,
      event: 'agent',
      nodeId: 'n1',
      sessions: ['s1'],
      tasks: [],
      missed: false,
      requests: true,
    })
  const topButton = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>('header button[aria-label="Needs you"]')
  // Home's section, or the popover, which draws on the document's body.
  const homeList = (root: HTMLElement) => root.querySelector<HTMLElement>('.view section[aria-label="Needs you"]')
  const popover = () => document.querySelector<HTMLElement>('.needs-you-popover')
  const rows = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>('li')]
  const row = (list: HTMLElement, title: string) =>
    rows(list).find((item) => item.querySelector('.row-title')?.textContent === title)!
  const press = async (element: HTMLElement) => {
    element.click()
    await settle(20)
  }
  const pressRow = (list: HTMLElement, title: string) => press(row(list, title).querySelector<HTMLElement>('.ui-row')!)
  const allowOnce = () =>
    permission({
      options: [
        { id: 'allow_once', label: 'Allow once', reject: false },
        { id: 'reject_once', label: 'Deny', reject: true },
      ],
    })

  it('shows the button with the count on Home, a task, and a conversation, and hides it when nothing waits', async () => {
    const subject = mount()
    await settle(20)
    expect(topButton(subject.root)).toBeNull()

    subject.state.agentRequests.push(allowOnce(), permission({ requestId: 'r2', title: 'Second' }))
    hint(subject)
    await settle(20)
    expect(topButton(subject.root)!.textContent).toBe('2')
    await openTask(subject.root, 'Fix it')
    expect(topButton(subject.root)!.textContent).toBe('2')
    await openChat(subject.root, 'Chat s1')
    expect(topButton(subject.root)!.textContent).toBe('2')

    subject.state.agentRequests.forEach((request) => (request.status = 'resolved'))
    hint(subject)
    await settle(20)
    expect(topButton(subject.root)).toBeNull()
  })

  it("answers a permission from Home's list in two clicks, shows the result, and then lets it go", async () => {
    const subject = mount()
    subject.state.agentRequests.push(allowOnce())
    await settle(20)
    const list = homeList(subject.root)!
    expect(list.querySelector('h2')!.textContent).toBe('Needs you 1')
    // Collapsed: the request, then its conversation and task.
    expect(row(list, 'Run rm -rf build').querySelector('.row-meta')!.textContent).toBe('Chat s1 · Fix it')
    expect(button(list, 'Allow once')).toBeUndefined()

    await pressRow(list, 'Run rm -rf build')
    expect(row(list, 'Run rm -rf build').textContent).toContain('In /src/acorn')
    await press(button(list, 'Allow once')!)
    expect([...subject.state.resolutions.values()]).toEqual([{ optionId: 'allow_once' }])
    expect(rows(list)[0]!.textContent).toBe('Allowed onceRun rm -rf build')

    // The next pending list drops it, but the result stays a moment first.
    hint(subject)
    await settle(20)
    expect(rows(homeList(subject.root)!)[0]!.textContent).toBe('Allowed onceRun rm -rf build')
    await new Promise((resolve) => setTimeout(resolve, 1_600))
    expect(homeList(subject.root)).toBeNull()
  })

  it('opens from a conversation as a popover, and says when nothing waits', async () => {
    const subject = mount()
    subject.state.agentRequests.push(allowOnce())
    await openSession(subject, 's2')
    await press(topButton(subject.root)!)
    expect(popover()!.querySelector('h2')!.textContent).toBe('Needs you 1')
    await pressRow(popover()!, 'Run rm -rf build')
    await press(button(popover()!, 'Deny')!)
    expect([...subject.state.resolutions.values()]).toEqual([{ optionId: 'reject_once' }])
    expect(rows(popover()!)[0]!.textContent).toBe('DeniedRun rm -rf build')

    hint(subject)
    await new Promise((resolve) => setTimeout(resolve, 1_600))
    await settle(20)
    // The button stays while its popover is open, so the popover can say so.
    expect(popover()!.textContent).toContain('Nothing waits on you.')
    expect(topButton(subject.root)!.textContent).toBe('0')
  })

  it('answers a single-choice question in place, and Open chat opens its conversation', async () => {
    const subject = mount()
    subject.state.agentRequests.push(
      permission({
        kind: 'question',
        title: 'Which size?',
        detail: null,
        options: [],
        questions: [
          {
            id: 'size',
            header: null,
            prompt: 'Which paper size?',
            options: [
              { label: 'A4', description: null },
              { label: 'Letter', description: null },
            ],
            multiple: false,
            secret: false,
          },
        ],
      }),
      permission({ requestId: 'r2', title: 'Run it again' }),
    )
    await settle(20)
    const list = homeList(subject.root)!
    await pressRow(list, 'Which size?')
    expect(row(list, 'Which size?').textContent).toContain('Which paper size?')
    await press(button(list, 'A4')!)
    expect([...subject.state.resolutions.values()]).toEqual([{ answers: { size: 'A4' } }])
    expect(rows(list)[0]!.textContent).toBe('Answered: A4Which size?')

    await pressRow(list, 'Run it again')
    await press(button(list, 'Open chat')!)
    expect(conversationTitle(subject.root)).toBe('Chat s1')
  })

  it('opens a form in its conversation instead of expanding it', async () => {
    const subject = mount()
    subject.state.agentRequests.push(
      permission({
        kind: 'question',
        title: 'A few details',
        detail: null,
        options: [],
        questions: [{ id: 'why', header: null, prompt: 'Why?', options: [], multiple: false, secret: false }],
      }),
    )
    await settle(20)
    await pressRow(homeList(subject.root)!, 'A few details')
    expect(conversationTitle(subject.root)).toBe('Chat s1')
    expect(subject.root.querySelector('article.request input[name="answer:why"]')).toBeTruthy()
  })

  it('shows the answer another client gave first, with no second answer', async () => {
    const subject = mount()
    subject.state.agentRequests.push(allowOnce())
    await settle(20)
    const list = homeList(subject.root)!
    await pressRow(list, 'Run rm -rf build')
    Object.assign(subject.state.agentRequests[0]!, { status: 'resolved', answer: 'Allow once' })
    await press(button(list, 'Deny')!)
    expect(subject.state.resolutions.size).toBe(0)
    expect(rows(list)[0]!.textContent).toBe('Allowed onceRun rm -rf build')
  })
})

const permission = (extra: Partial<BridgeAgentRequest> = {}): BridgeAgentRequest & { sessionId: string } => ({
  sessionId: 's1',
  requestId: 'r1',
  kind: 'permission',
  status: 'pending',
  title: 'Run rm -rf build',
  detail: 'rm -rf build\nIn /src/acorn',
  options: [
    { id: 'allow_once', label: 'Allow', reject: false },
    { id: 'reject_once', label: 'Reject', reject: true },
  ],
  questions: [],
  approval: null,
  answer: null,
  sentNote: null,
  unsupported: null,
  ...extra,
})

describe('questions and approvals', () => {
  const card = (root: HTMLElement) => root.querySelector<HTMLElement>('article.request')
  const status = (root: HTMLElement) => card(root)?.querySelector('[data-testid="request-status"]')?.textContent
  const resolves = (subject: ReturnType<typeof mount>) =>
    subject.state.requests.filter((request) => request.op === 'request.resolve')
  const hint = (subject: ReturnType<typeof mount>) =>
    subject.state.host!.send({ v: 1, event: 'agent', nodeId: 'n1', sessions: ['s1'], tasks: [], missed: false })

  it('shows a permission request in full and answers with the option id', async () => {
    const subject = mount()
    subject.state.agentRequests.push(permission())
    await openSession(subject)
    expect(card(subject.root)!.textContent).toContain('Run rm -rf build')
    expect(card(subject.root)!.textContent).toContain('In /src/acorn')
    // The amber stripe says it waits, so no line under it does.
    expect(card(subject.root)!.querySelector('.ui-card')!.getAttribute('data-stripe')).toBe('warn')
    expect(card(subject.root)!.querySelector('.eyebrow')!.textContent).toBe('Permission')
    expect(status(subject.root)).toBeUndefined()

    button(subject.root, 'Reject')!.click()
    await settle()
    expect(resolves(subject)).toMatchObject([
      { nodeId: 'n1', sessionId: 's1', requestId: 'r1', resolution: { optionId: 'reject_once' } },
    ])
    expect(status(subject.root)).toBe('Answered: Reject')
    expect(button(subject.root, 'Allow')).toBeUndefined()
  })

  it('answers a form with labels, several choices, typed text, and a secret it never stores', async () => {
    const subject = mount()
    subject.state.agentRequests.push(
      permission({
        kind: 'question',
        title: 'A few details',
        detail: null,
        options: [{ id: 'decline', label: 'Skip', reject: true }],
        questions: [
          {
            id: 'colour',
            header: 'Colour',
            prompt: 'Which one?',
            options: [
              { label: 'Blue', description: null },
              { label: 'Green', description: null },
            ],
            multiple: false,
            secret: false,
          },
          {
            id: 'parts',
            header: null,
            prompt: 'Which parts?',
            options: [
              { label: 'Front', description: 'The page' },
              { label: 'Back', description: null },
            ],
            multiple: true,
            secret: false,
          },
          { id: 'why', header: null, prompt: 'Why?', options: [], multiple: false, secret: false },
          { id: 'token', header: null, prompt: 'API token', options: [], multiple: false, secret: true },
        ],
      }),
    )
    await openSession(subject)
    const field = (name: string) => card(subject.root)!.querySelector<HTMLInputElement>(`[name="${name}"]`)!
    expect(field('answer:token').type).toBe('password')
    expect(field('answer:why').type).toBe('text')
    choose(subject.root, 'answer:colour', 'Green')
    for (const name of ['answer:parts:Front', 'answer:parts:Back']) {
      field(name).checked = true
      field(name).dispatchEvent(new Event('change', { bubbles: true }))
    }
    for (const [name, value] of [
      ['answer:why', 'Because'],
      ['answer:token', 'hunter2'],
    ]) {
      field(name).value = value!
      field(name).dispatchEvent(new Event('input', { bubbles: true }))
    }
    await settle()
    card(subject.root)!
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(resolves(subject)[0]!.resolution).toEqual({
      answers: { colour: 'Green', parts: ['Front', 'Back'], why: 'Because', token: 'hunter2' },
    })
    expect(status(subject.root)).toBe('Answered')
    expect(card(subject.root)!.querySelector('input')).toBeNull()
    expect(JSON.stringify([...subject.fake.storage.values()])).not.toContain('hunter2')
  })

  it('settles a request another client answered first, with no second answer', async () => {
    const subject = mount()
    subject.state.agentRequests.push(permission())
    await openSession(subject)
    // Another client answers while this sidebar still shows the buttons.
    Object.assign(subject.state.agentRequests[0]!, { status: 'resolved', answer: 'Allow' })
    button(subject.root, 'Reject')!.click()
    await settle()
    expect(status(subject.root)).toBe('Answered: Allow')
    expect(subject.state.resolutions.size).toBe(0)
    expect(button(subject.root, 'Reject')).toBeUndefined()

    // A hint alone is enough when nobody presses anything here.
    subject.state.agentRequests.push(permission({ requestId: 'r2', title: 'Second' }))
    hint(subject)
    await settle()
    expect(button(subject.root, 'Allow')).toBeTruthy()
    Object.assign(subject.state.agentRequests[1]!, { status: 'expired' })
    hint(subject)
    await settle()
    expect(card(subject.root)!.nextElementSibling!.textContent).toContain('Expired')
    expect(button(subject.root, 'Allow')).toBeUndefined()
  })

  it('reads again after an unconfirmed answer, never resends it, and reuses its key when pressed again', async () => {
    const subject = mount()
    subject.state.agentRequests.push(permission())
    await openSession(subject)
    // The answer never reaches the Node, and the reply is lost.
    subject.state.answers.set('request.resolve', () => ({
      error: { code: 'ambiguous_mutation', message: 'The Node did not confirm the change.' },
    }))
    button(subject.root, 'Allow')!.click()
    await settle()
    expect(card(subject.root)!.textContent).toContain("didn't confirm this answer")
    const reads = subject.state.requests.filter((request) => request.op === 'session.read').length
    expect(reads).toBeGreaterThan(1)
    subject.state.host!.send({ v: 1, event: 'status', status: { nodeId: 'n1', state: 'offline' } })
    subject.state.host!.send({ v: 1, event: 'status', status: { nodeId: 'n1', state: 'online' } })
    await settle()
    expect(resolves(subject)).toHaveLength(1)

    subject.state.answers.delete('request.resolve')
    button(subject.root, 'Allow')!.click()
    await settle()
    expect(new Set(resolves(subject).map((request) => request.key)).size).toBe(1)
    expect(status(subject.root)).toBe('Answered: Allow')
  })

  it('binds an answer to its conversation when the person switches away before it returns', async () => {
    const subject = mount()
    subject.state.agentRequests.push(permission())
    await openSession(subject)
    let release!: () => void
    subject.state.holds.set('request.resolve', (answer) => (release = answer))
    button(subject.root, 'Allow')!.click()
    await settle()
    subject.state.holds.delete('request.resolve')
    await openChat(subject.root, 'Chat s2')
    release()
    await settle()
    expect(resolves(subject)).toMatchObject([{ sessionId: 's1', requestId: 'r1' }])
    expect(card(subject.root)).toBeNull()
    expect(subject.state.resolutions.size).toBe(1)
    // Back in s1, the request settled while it wasn't shown, so it is history, not a card.
    await openChat(subject.root, 'Chat s1')
    expect(card(subject.root)).toBeNull()
  })

  it('holds answers while the Node is away', async () => {
    const subject = mount()
    subject.state.agentRequests.push(permission())
    await openSession(subject)
    subject.state.host!.send({ v: 1, event: 'status', status: { nodeId: 'n1', state: 'offline' } })
    await settle()
    expect(button(subject.root, 'Allow')!.hasAttribute('disabled')).toBe(true)
    expect(card(subject.root)!.textContent).toContain('Answer once it is')
  })

  it('shows app access in full, and a request it cannot answer with its reason and no buttons', async () => {
    const subject = mount()
    subject.state.agentRequests.push(
      permission({
        approval: { target: 'Notes (com.apple.Notes)', scopeNote: 'Always allow lasts.', warning: 'Reads notes.' },
      }),
      permission({
        requestId: 'r2',
        kind: 'workflow_gate',
        title: 'Continue the workflow?',
        unsupported: "The extension can't answer a workflow gate request yet. Answer it in the Acorn app.",
      }),
    )
    await openSession(subject)
    const [approval, gate] = [...subject.root.querySelectorAll<HTMLElement>('article.request')]
    expect(approval!.textContent).toContain('App: Notes (com.apple.Notes)')
    expect(approval!.textContent).toContain('Always allow lasts.')
    expect(approval!.textContent).toContain('Reads notes.')
    expect(gate!.textContent).toContain('Continue the workflow?')
    expect(gate!.textContent).toContain('Choices: Allow, Reject')
    expect(gate!.textContent).toContain('Answer it in the Acorn app')
    expect(gate!.querySelector('button')).toBeNull()
  })
})

describe('attachments', () => {
  const written = (subject: ReturnType<typeof mount>, op: string) =>
    subject.state.requests.filter((request) => request.op === op)

  it('draws the screenshots a turn sent, read through the bridge', async () => {
    const created: string[] = []
    const revoked: string[] = []
    Object.assign(URL, {
      createObjectURL: () => `blob:shot-${created.push('x')}`,
      revokeObjectURL: (url: string) => revoked.push(url),
    })
    const subject = mount()
    subject.state.answers.set('attachment.read', (request) => ({
      result: {
        nodeId: 'n1',
        taskId: request.taskId,
        attachment: { id: request.attachmentId, taskId: 't1', filename: 'a.jpg', mediaType: 'image/jpeg', byteSize: 3 },
        data: 'AAAA',
      },
    }))
    subject.state.events.get('s1')!.push({
      id: 's1-e1',
      seq: 1,
      turnId: 'turn',
      createdAt: 1,
      event: {
        type: 'user_message',
        text: 'Look',
        attachments: [
          { id: 'a1', image: true, name: 'Screenshot of Docs' },
          { id: 'a2', image: false, name: null },
        ],
      },
    })
    subject.state.sessions[0]!.lastEventSeq = 1
    await openSession(subject)
    expect(written(subject, 'attachment.read')).toMatchObject([{ taskId: 't1', attachmentId: 'a1' }])
    expect(subject.root.querySelector('.transcript img')!.getAttribute('src')).toBe('blob:shot-1')
    expect(transcript(subject.root)).toEqual(['YouLookScreenshot of DocsAttachment'])
    await openChat(subject.root, 'Chat s2')
    expect(revoked).toEqual(['blob:shot-1'])
  })
})

describe('Add to Acorn chat', () => {
  const captures = (root: HTMLElement) =>
    [...root.querySelectorAll('[data-testid="capture"] strong')].map((item) => item.textContent)
  // The page's right-click entry, on a selection, with this browser's Node remembered.
  const selected = (fake = fakeBrowser()) => {
    fake.storage.set(SELECTED_NODE_KEY, 'n1')
    fake.selection = 'The failing assertion'
    return fake
  }
  const rightClick = async (subject: ReturnType<typeof mount>) => {
    subject.fake.clickMenu('add-to-acorn-chat')
    await settle(30)
  }
  const storedCaptures = (subject: ReturnType<typeof mount>) =>
    [...subject.fake.storage.keys()].filter((key) => key.startsWith('captures:'))

  it('is made at install, on selected text', () => {
    const subject = mount()
    subject.fake.install()
    expect(subject.fake.menus.get('add-to-acorn-chat')).toEqual({ title: 'Add to Acorn chat', contexts: ['selection'] })
  })

  it('adds the selection to the open conversation and sends it', async () => {
    const subject = mount(selected())
    await openSession(subject, 's2')
    await rightClick(subject)
    expect(subject.fake.panelOpens).toEqual([1])
    expect(conversationTitle(subject.root)).toBe('Chat s2')
    expect(captures(subject.root)).toEqual(['Selected text · Docs'])

    send(subject.root)
    await settle()
    const [input] = [...subject.state.inputs.values()]
    expect(input).toMatchObject([
      {
        type: 'context',
        label: 'Selected text from Docs',
        content: 'From https://example.test/docs:\n\nThe failing assertion',
      },
    ])
  })

  it('adds the selection to the newest conversation of the task the panel shows', async () => {
    const subject = mount(selected())
    await openSession(subject, 's2')
    await back(subject.root)
    await rightClick(subject)
    expect(conversationTitle(subject.root)).toBe('Chat s1')
    expect(captures(subject.root)).toEqual(['Selected text · Docs'])
  })

  it('leaves the draft filled when the browser refuses to open the panel', async () => {
    const fake = selected()
    fake.refusePanel = true
    fake.storage.set('destination:n1', { projectId: 'p1', taskId: 't1', sessionId: null })
    const subject = mount(fake)
    dispose?.()
    await rightClick(subject)
    expect(fake.panelOpens).toEqual([])
    expect(storedCaptures(subject)).toEqual(['captures:n1:t1:s1'])

    const root = subject.reopen()
    await settle(30)
    expect(conversationTitle(root)).toBe('Chat s1')
    expect(captures(root)).toEqual(['Selected text · Docs'])
  })

  it('says why, and keeps nothing, when no task is current', async () => {
    const subject = mount(selected())
    await settle()
    await rightClick(subject)
    expect(subject.fake.panelOpens).toEqual([1])
    expect(subject.root.textContent).toContain("No task is current, so the selection wasn't added.")
    expect(storedCaptures(subject)).toEqual([])
    button(subject.root, 'Dismiss')!.click()
    await settle()
    expect(subject.root.textContent).not.toContain('No task is current')
  })

  it('says why when no Node is selected', async () => {
    const fake = fakeBrowser()
    fake.selection = 'The failing assertion'
    const subject = mount(fake)
    await rightClick(subject)
    expect(subject.root.textContent).toContain("No Node is selected, so the selection wasn't added.")
    expect(storedCaptures(subject)).toEqual([])
  })

  it('says why when the Node cannot be reached', async () => {
    const subject = mount(selected())
    subject.fake.storage.set('destination:n1', { projectId: 'p1', taskId: 't1', sessionId: null })
    subject.state.answers.set('sessions.list', () => ({
      error: { code: 'node_unreachable', message: 'The Node did not answer.' },
    }))
    await rightClick(subject)
    expect(subject.root.textContent).toContain("The selection wasn't added: The Node did not answer.")
    expect(storedCaptures(subject)).toEqual([])
  })
})
