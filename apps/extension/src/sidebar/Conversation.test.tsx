import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import type { BridgeAgentSession, BridgeConversationRecord, BridgeInputPart } from '@acorn/protocol/extensionBridge.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle, type FakeHost } from '../test/fakeBrowser'
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
  kind: 'interactive',
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
        return { result: { nodeId: 'n1', projects: [{ id: 'p1', name: 'Acorn', path: null, hidden: false }] } }
      case 'tasks.list':
        return { result: { nodeId: 'n1', projectId: 'p1', tasks: [{ id: 't1', title: 'Fix it', branch: null }] } }
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
      case 'agents.profiles':
        return {
          result: {
            nodeId: 'n1',
            profiles: [
              {
                providerId: 'codex',
                profileId: 'codex',
                label: 'Codex',
                installed: false,
                authenticated: null,
                diagnostics: ['codex not found'],
              },
              {
                providerId: 'claude',
                profileId: 'claude-code',
                label: 'Claude Code',
                installed: true,
                authenticated: true,
                diagnostics: [],
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
    .querySelector('section[aria-label="Conversation"] form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)
const transcript = (root: HTMLElement) => [...root.querySelectorAll('.transcript li')].map((item) => item.textContent)
const draft = (root: HTMLElement) => root.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.value

async function openSession(root: HTMLElement, sessionId = 's1') {
  await settle()
  choose(root, 'project', 'p1')
  await settle()
  choose(root, 'task', 't1')
  await settle()
  choose(root, 'session', sessionId)
  await settle()
}

describe('conversation', () => {
  it('shows the conversation, and reads on from its end when a hint names it', async () => {
    const subject = mount()
    subject.say('s1', 'Hello from the desktop', 'user_message')
    subject.say('s1', 'Hi')
    await openSession(subject.root)
    expect(subject.root.querySelector('[data-testid="destination"]')!.textContent).toContain(
      'Studio › Acorn › Fix it › Chat s1',
    )
    expect(transcript(subject.root)).toEqual(['YouHello from the desktop', 'AgentHi'])

    subject.say('s1', 'A reply another client caused')
    subject.state.host!.send({ v: 1, event: 'agent', nodeId: 'n1', sessions: ['s1'], tasks: [], missed: false })
    await settle()
    const reads = subject.state.requests.filter((request) => request.op === 'session.read')
    expect(reads.map((request) => request.afterSeq)).toEqual([0, 2])
    expect(transcript(subject.root)).toEqual([
      'YouHello from the desktop',
      'AgentHi',
      'AgentA reply another client caused',
    ])
  })

  it('keeps an unsent draft and the destination when the sidebar closes and opens again', async () => {
    const subject = mount()
    await openSession(subject.root)
    type(subject.root, 'Half a thought')
    await settle()
    const root = subject.reopen()
    await settle(20)
    expect((root.querySelector('select[name="session"]') as HTMLSelectElement).value).toBe('s1')
    expect(draft(root)).toBe('Half a thought')
  })

  it('gives each conversation its own draft and drops a slow read for the one it left', async () => {
    const subject = mount()
    subject.say('s1', 'Only in s1')
    await openSession(subject.root)
    type(subject.root, 'For s1')
    choose(subject.root, 'session', '')
    await settle()
    // Open s1 again, but leave for s2 before its read answers.
    let slow!: () => void
    subject.state.holds.set('session.read', (answer) => (slow = answer))
    choose(subject.root, 'session', 's1')
    await settle()
    subject.state.holds.delete('session.read')
    choose(subject.root, 'session', 's2')
    await settle()
    slow()
    await settle()
    expect(subject.root.querySelector('[data-testid="destination"]')!.textContent).toContain('Chat s2')
    expect(transcript(subject.root)).toEqual([])
    expect(draft(subject.root)).toBe('')
    choose(subject.root, 'session', 's1')
    await settle()
    expect(transcript(subject.root)).toEqual(['AgentOnly in s1'])
    expect(draft(subject.root)).toBe('For s1')
  })

  it('keeps an unconfirmed message and retries it with the same key, making one turn', async () => {
    const subject = mount()
    await openSession(subject.root)
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
    await openSession(subject.root)
    type(subject.root, 'For s1 only')
    let release!: () => void
    subject.state.holds.set('turn.submit', (answer) => (release = answer))
    send(subject.root)
    await settle()
    subject.state.holds.delete('turn.submit')
    choose(subject.root, 'session', 's2')
    await settle()
    type(subject.root, 'Typed in s2')
    release()
    await settle()
    expect(subject.state.requests.find((request) => request.op === 'turn.submit')).toMatchObject({ sessionId: 's1' })
    expect(draft(subject.root)).toBe('Typed in s2')
    expect(subject.fake.storage.get('draft:n1:t1:s1')).toBeUndefined()
    choose(subject.root, 'session', 's1')
    await settle()
    expect(draft(subject.root)).toBe('')
    expect(transcript(subject.root)).toEqual(['YouFor s1 only'])
  })

  it('reads again when the Node comes back, and holds sends while it is away', async () => {
    const subject = mount()
    await openSession(subject.root)
    subject.state.host!.send({ v: 1, event: 'status', status: { nodeId: 'n1', state: 'offline' } })
    await settle()
    type(subject.root, 'Wait for it')
    await settle()
    expect(button(subject.root, 'Send')!.hasAttribute('disabled')).toBe(true)
    expect(subject.root.textContent).toContain('The Node is not connected')
    subject.say('s1', 'Said while you were away')
    subject.state.host!.send({ v: 1, event: 'status', status: { nodeId: 'n1', state: 'online' } })
    await settle()
    expect(transcript(subject.root)).toEqual(['AgentSaid while you were away'])
    expect(button(subject.root, 'Send')!.hasAttribute('disabled')).toBe(false)
  })

  it('keeps the draft of a conversation that is gone or archived and refuses to send', async () => {
    const subject = mount()
    await openSession(subject.root)
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

  it('starts a chat with an installed profile and names the ones that cannot start', async () => {
    const subject = mount()
    await openSession(subject.root)
    button(subject.root, 'New chat')!.click()
    await settle()
    const options = [...subject.root.querySelectorAll('select[name="profile"] option')] as HTMLOptionElement[]
    expect(options.map((option) => [option.textContent, option.disabled])).toEqual([
      ['Codex (codex not found)', true],
      ['Claude Code', false],
    ])
    subject.state.answers.set('session.create', () => ({ error: { code: 'ambiguous_mutation', message: 'lost' } }))
    button(subject.root, 'Start chat')!.click()
    await settle()
    expect(subject.root.textContent).toContain("didn't confirm the new chat")
    subject.state.answers.delete('session.create')
    button(subject.root, 'Start chat')!.click()
    await settle()
    const creates = subject.state.requests.filter((request) => request.op === 'session.create')
    expect(creates.map((request) => [request.providerId, request.profileId])).toEqual([
      ['claude', 'claude-code'],
      ['claude', 'claude-code'],
    ])
    expect(new Set(creates.map((request) => request.key)).size).toBe(1)
    expect((subject.root.querySelector('select[name="session"]') as HTMLSelectElement).value).toBe('s3')
    expect(subject.root.querySelector('[data-testid="destination"]')!.textContent).toContain('New chat')
  })
})

describe('page capture', () => {
  const captures = (root: HTMLElement) =>
    [...root.querySelectorAll('[data-testid="capture"] strong')].map((item) => item.textContent)
  const capture = async (root: HTMLElement, label: string) => {
    button(root, label)!.click()
    await settle()
  }
  const written = (subject: ReturnType<typeof mount>, op: string) =>
    subject.state.requests.filter((request) => request.op === op)

  it('keeps captures in the browser until send, then sends them in one turn', async () => {
    const subject = mount()
    subject.fake.selection = '  The failing assertion  '
    await openSession(subject.root)
    await capture(subject.root, 'Add page link')
    await capture(subject.root, 'Add selected text')
    await capture(subject.root, 'Add screenshot')
    expect(captures(subject.root)).toEqual(['Page · Docs', 'Selected text · Docs', 'Screenshot · Docs'])
    expect(subject.root.textContent).toContain('Goes with your next message to Studio › Acorn › Fix it › Chat s1')
    expect(subject.root.querySelector('[data-testid="capture"] img')!.getAttribute('src')).toMatch(/^data:image\/jpeg/)
    // Capture and preview send nothing to the Node.
    expect(written(subject, 'attachment.upload')).toEqual([])
    expect(written(subject, 'turn.submit')).toEqual([])

    button(subject.root, 'Remove')!.click()
    await settle()
    const root = subject.reopen()
    await settle(20)
    expect(captures(root)).toEqual(['Selected text · Docs', 'Screenshot · Docs'])

    type(root, 'What broke?')
    send(root)
    await settle()
    expect(written(subject, 'attachment.upload')).toMatchObject([
      { taskId: 't1', mediaType: 'image/jpeg', filename: 'Screenshot of example.test.jpg' },
    ])
    const [input] = [...subject.state.inputs.values()]
    expect(input).toMatchObject([
      { type: 'text', text: 'What broke?' },
      {
        type: 'context',
        label: 'Selected text from Docs',
        content: 'From https://example.test/docs:\n\nThe failing assertion',
        source: 'browser-extension',
        resourceId: 'https://example.test/docs',
      },
      { type: 'image', attachmentId: 'att-1', alt: 'Screenshot of Docs' },
    ])
    expect(captures(root)).toEqual([])
    expect(draft(root)).toBe('')
    expect([...subject.fake.storage.keys()].filter((key) => /^(draft|captures):/.test(key))).toEqual([])
  })

  it('asks for the toolbar button when the browser gives no access to the page', async () => {
    const subject = mount()
    subject.fake.activeTab = { id: 1, windowId: 1 }
    await openSession(subject.root)
    await capture(subject.root, 'Add page link')
    await capture(subject.root, 'Add screenshot')
    expect(captures(subject.root)).toEqual([])
    expect(subject.root.textContent).toContain('Click the Acorn button in the toolbar')
  })

  it('says a granted site still needs the toolbar button for a screenshot', async () => {
    const subject = mount()
    await openSession(subject.root)
    // Firefox's answer when a site is granted but the toolbar button wasn't clicked.
    subject.fake.onCapture = async () => {
      throw new Error('Missing activeTab permission')
    }
    await capture(subject.root, 'Add page link')
    await capture(subject.root, 'Add screenshot')
    expect(captures(subject.root)).toEqual(['Page · Docs'])
    expect(subject.root.textContent).toContain('The browser takes a screenshot only of a page you clicked')
  })

  it('keeps no screenshot when the tab changes while it is taken', async () => {
    const subject = mount()
    await openSession(subject.root)
    subject.fake.onCapture = async () => {
      subject.fake.activeTab = { id: 2, windowId: 1, url: 'https://example.test/other', title: 'Other' }
      return 'data:image/jpeg;base64,/9j/4AAQ'
    }
    await capture(subject.root, 'Add screenshot')
    expect(captures(subject.root)).toEqual([])
    expect(subject.root.textContent).toContain('The page changed while it was being captured')
  })

  it('reports a capture over the limits before anything is uploaded', async () => {
    const subject = mount()
    await openSession(subject.root)
    subject.fake.onCapture = async () => `data:image/jpeg;base64,${'A'.repeat(8 * 1024 * 1024)}`
    await capture(subject.root, 'Add screenshot')
    expect(subject.root.textContent).toContain('over the 5.0 MB a draft keeps')
    subject.fake.selection = 'x'.repeat(600 * 1024)
    await capture(subject.root, 'Add selected text')
    expect(subject.root.textContent).toContain('Captured text is limited to 512 KiB')
    subject.fake.selection = ''
    await capture(subject.root, 'Add selected text')
    expect(subject.root.textContent).toContain('Nothing is selected on this page')
    expect(captures(subject.root)).toEqual([])
    expect(written(subject, 'attachment.upload')).toEqual([])
  })

  it('keeps an uploaded screenshot with the draft when the send is uncertain, and reuses it on retry', async () => {
    const subject = mount()
    await openSession(subject.root)
    await capture(subject.root, 'Add screenshot')
    subject.state.answers.set('turn.submit', () => ({ error: { code: 'host_unavailable', message: 'Gone.' } }))
    send(subject.root)
    await settle()
    expect(subject.root.textContent).toContain("didn't confirm this message")
    expect(subject.fake.storage.get('captures:n1:t1:s1')).toMatchObject([{ attachmentId: 'att-1' }])
    expect(button(subject.root, 'Retry')).toBeTruthy()

    subject.state.answers.delete('turn.submit')
    send(subject.root)
    await settle()
    expect(written(subject, 'attachment.upload')).toHaveLength(1)
    const keys = written(subject, 'turn.submit').map((request) => request.key)
    expect(new Set(keys).size).toBe(1)
    expect(subject.state.inputs.get(keys[0] as string)).toEqual([
      { type: 'image', attachmentId: 'att-1', alt: 'Screenshot of Docs' },
    ])
    expect(captures(subject.root)).toEqual([])
    // A sent screenshot leaves the draft without being deleted on the Node.
    expect(written(subject, 'attachment.delete')).toEqual([])
  })

  it('keeps the screenshot when its upload fails, and deletes an uploaded one the person removes', async () => {
    const subject = mount()
    await openSession(subject.root)
    await capture(subject.root, 'Add screenshot')
    subject.state.answers.set('attachment.upload', () => ({
      error: { code: 'node_error', message: 'Attachments are limited to 10 MiB each.' },
    }))
    send(subject.root)
    await settle()
    expect(subject.root.textContent).toContain('Attachments are limited to 10 MiB each.')
    expect(captures(subject.root)).toEqual(['Screenshot · Docs'])
    expect(written(subject, 'turn.submit')).toEqual([])

    subject.state.answers.delete('attachment.upload')
    subject.state.answers.set('turn.submit', () => ({ error: { code: 'node_error', message: 'Refused.' } }))
    send(subject.root)
    await settle()
    button(subject.root, 'Remove')!.click()
    await settle()
    expect(written(subject, 'attachment.delete')).toMatchObject([{ taskId: 't1', attachmentId: 'att-1' }])
    expect(subject.fake.storage.has('captures:n1:t1:s1')).toBe(false)
  })

  it('finishes an upload and send for the conversation it started in after a switch', async () => {
    const subject = mount()
    await openSession(subject.root)
    await capture(subject.root, 'Add screenshot')
    let release!: () => void
    subject.state.holds.set('attachment.upload', (answer) => (release = answer))
    send(subject.root)
    await settle()
    subject.state.holds.delete('attachment.upload')
    choose(subject.root, 'session', 's2')
    await settle()
    expect(captures(subject.root)).toEqual([])
    release()
    await settle()
    expect(written(subject, 'turn.submit')).toMatchObject([{ sessionId: 's1' }])
    expect(subject.fake.storage.has('captures:n1:t1:s1')).toBe(false)
    expect(captures(subject.root)).toEqual([])
  })

  it('lands a screenshot taken before a switch in the draft it was taken for', async () => {
    const subject = mount()
    await openSession(subject.root)
    let finish!: (value: string) => void
    subject.fake.onCapture = () => new Promise((resolve) => (finish = resolve))
    button(subject.root, 'Add screenshot')!.click()
    await settle()
    choose(subject.root, 'session', 's2')
    await settle()
    finish('data:image/jpeg;base64,/9j/4AAQ')
    await settle()
    expect(captures(subject.root)).toEqual([])
    expect(subject.fake.storage.get('captures:n1:t1:s1')).toMatchObject([{ kind: 'screenshot', title: 'Docs' }])
  })

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
    await openSession(subject.root)
    expect(written(subject, 'attachment.read')).toMatchObject([{ taskId: 't1', attachmentId: 'a1' }])
    expect(subject.root.querySelector('.transcript img')!.getAttribute('src')).toBe('blob:shot-1')
    expect(transcript(subject.root)).toEqual(['YouLookAttachment'])
    choose(subject.root, 'session', 's2')
    await settle()
    expect(revoked).toEqual(['blob:shot-1'])
  })
})
