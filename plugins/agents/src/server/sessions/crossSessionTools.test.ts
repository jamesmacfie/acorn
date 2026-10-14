import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  makeTestNodeContext,
  makeTestPluginDb,
  schema,
  type TestNodeContext,
  type TestPluginDb,
} from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '../../contract/wire'
import { AgentStore } from './store'
import { crossSessionTools, pageThread, READ_RESPONSE_MAX_BYTES } from './crossSessionTools'

// The three cross-session tools, driven through their handlers the way the MCP projection calls them.
// Core's tasks table says which project each task is in; the sessions and events are this plugin's.

const provider: AgentProviderDescriptor = {
  id: 'fake',
  profileId: 'fake',
  label: 'Fake',
  driverKind: 'acp',
  driverVersion: '1',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
}

const task = (id: string, projectId: string, status = 'active') => ({
  id,
  title: `Task ${id}`,
  origin: 'local' as const,
  projectId,
  branch: id,
  status,
  sort: 0,
  createdAt: 1,
  updatedAt: 1,
})

type Hit = {
  sessionId: string
  taskId: string
  match: string
  seq?: number
  excerpt: string
  archived: boolean
  taskArchived: boolean
  read: { sessionId: string; aroundSeq?: number; view?: string }
}
type Item = { role: string; fromSeq: number; toSeq: number; text: string; textRange?: { end: number; total: number } }
type ReadResult = {
  session: { sessionId: string; taskId: string }
  history: string
  boundarySeq: number
  items: Item[]
  nextCursor: string | null
  previousCursor: string | null
}

let host: TestNodeContext
let pluginDb: TestPluginDb
let store: AgentStore
let callerId: string
let claim: { taskId: string; sessionId: string; userLogin: string }

const tools = () => {
  const [list, search, read] = crossSessionTools(store, host.core)
  return { list: list!, search: search!, read: read! }
}
const session = (taskId: string, title?: string) =>
  store
    .createSession({ taskId, providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }, provider)
    .then(async (created) => (title ? store.patchSession(created.id, { title }) : created))
const listIds = async (args: object) =>
  ((await tools().list.handler(args, claim)) as { sessions: { sessionId: string }[] }).sessions.map((s) => s.sessionId)
const searchHits = async (args: object) => ((await tools().search.handler(args, claim)) as { hits: Hit[] }).hits
const readThread = async (args: object) => (await tools().read.handler(args, claim)) as ReadResult

beforeEach(async () => {
  host = makeTestNodeContext({ plugin: { name: 'agents' } })
  pluginDb = makeTestPluginDb('agents')
  await host.db
    .insert(schema.tasks)
    .values([task('mine', 'app'), task('sibling', 'app'), task('old', 'app', 'archived'), task('foreign', 'other')])
  store = new AgentStore(pluginDb.db, host.core)
  callerId = (await session('mine', 'The caller')).id
  claim = { taskId: 'mine', sessionId: callerId, userLogin: 'test' }
})

afterEach(() => {
  pluginDb.cleanup()
  host.cleanup()
})

describe('agent_session_list', () => {
  it('contributes three session-required reads', () => {
    expect(
      crossSessionTools(store, host.core).map(({ name, scope, risk, requiresSession }) => ({
        name,
        scope,
        risk,
        requiresSession,
      })),
    ).toEqual([
      { name: 'agent_session_list', scope: 'task', risk: 'read', requiresSession: true },
      { name: 'agent_session_search', scope: 'task', risk: 'read', requiresSession: true },
      { name: 'agent_session_read', scope: 'task', risk: 'read', requiresSession: true },
    ])
  })

  it('returns each scope’s sessions, never another project’s, and leaves out the caller', async () => {
    const own = await session('mine', 'Own second')
    const sibling = await session('sibling', 'Sibling work')
    const archived = await session('old', 'Old decision')
    await session('foreign', 'Foreign work')

    expect(new Set(await listIds({ scope: 'task' }))).toEqual(new Set([own.id]))
    expect(new Set(await listIds({ scope: 'other_tasks' }))).toEqual(new Set([sibling.id, archived.id]))
    expect(new Set(await listIds({}))).toEqual(new Set([own.id, sibling.id, archived.id]))
    expect(await listIds({ scope: 'task', includeCurrentSession: true })).toContain(callerId)
    expect(await listIds({ includeArchived: false })).not.toContain(archived.id)
    // A taskId narrows the scope and cannot widen it.
    expect(await listIds({ scope: 'task', taskId: 'sibling' })).toEqual([])
    expect(await listIds({ taskId: 'foreign' })).toEqual([])
    expect(await listIds({ titleQuery: 'sibling' })).toEqual([sibling.id])
    // A task's title matches every session in it.
    expect(await listIds({ titleQuery: 'task old' })).toEqual([archived.id])

    const page = (await tools().list.handler({ taskId: 'foreign' }, claim)) as Record<string, unknown>
    expect(page).toMatchObject({ effectiveScope: { scope: 'project', taskId: 'foreign' }, sessions: [] })
    expect(page.note).toContain('No sessions')
  })

  it('marks archive and history state and omits configuration', async () => {
    const archived = await session('old', 'Old decision')
    await store.patchSession(archived.id, { archived: true })
    const [row] = ((await tools().list.handler({ taskId: 'old' }, claim)) as { sessions: Record<string, unknown>[] })
      .sessions
    expect(row).toMatchObject({
      sessionId: archived.id,
      taskId: 'old',
      taskTitle: 'Task old',
      projectId: 'app',
      archived: true,
      taskArchived: true,
      history: 'available',
    })
    expect(row).not.toHaveProperty('config')
  })

  it('pages by latest activity and refuses a cursor from another request', async () => {
    const ids = []
    for (let index = 0; index < 5; index += 1) ids.push((await session('sibling', `S${index}`)).id)
    const first = (await tools().list.handler({ limit: 2 }, claim)) as {
      sessions: { sessionId: string }[]
      nextCursor: string
    }
    expect(first.sessions).toHaveLength(2)
    const seen = first.sessions.map((row) => row.sessionId)
    let cursor: string | null = first.nextCursor
    while (cursor) {
      const next = (await tools().list.handler({ limit: 2, cursor }, claim)) as {
        sessions: { sessionId: string }[]
        nextCursor: string | null
      }
      seen.push(...next.sessions.map((row) => row.sessionId))
      cursor = next.nextCursor
    }
    expect(new Set(seen)).toEqual(new Set(ids))
    expect(seen).toHaveLength(5)
    await expect(tools().list.handler({ limit: 2, scope: 'task', cursor: first.nextCursor }, claim)).rejects.toThrow(
      'cursor',
    )
    await expect(tools().list.handler({ cursor: 'not-a-cursor' }, claim)).rejects.toThrow('cursor')
  })

  it('requires a managed session in the claimed task', async () => {
    await expect(tools().list.handler({}, { taskId: 'mine', userLogin: 'test' })).rejects.toThrow('claim')
    await expect(tools().list.handler({}, { ...claim, taskId: 'sibling' })).rejects.toThrow('unavailable')
  })
})

describe('agent_session_search', () => {
  it('matches a streamed message whole, filters roles and scope before the limit, and hands back read inputs', async () => {
    const sibling = await session('sibling', 'Renderer work')
    const foreign = await session('foreign', 'Foreign')
    await store.recordEvent(sibling.id, 'turn', { type: 'user_message', text: 'why does the frame crash?' })
    const head = await store.recordEvent(sibling.id, 'turn', {
      type: 'assistant_message',
      append: true,
      messageId: 'm',
      text: 'The iframe ',
    })
    await store.recordEvent(sibling.id, 'turn', {
      type: 'assistant_message',
      append: true,
      messageId: 'm',
      text: 'crash came from frame regions.',
    })
    await store.recordEvent(sibling.id, 'turn', {
      type: 'tool',
      tool: { id: 't', name: 'Bash', title: 'iframe crash test', output: 'iframe crash: 1 failed', status: 'failed' },
    })
    await store.recordEvent(sibling.id, 'turn', { type: 'reasoning', text: 'iframe crash hidden thoughts' })
    await store.recordEvent(foreign.id, 'turn', { type: 'user_message', text: 'iframe crash elsewhere' })
    await store.recordEvent(callerId, 'turn', { type: 'user_message', text: 'iframe crash, please look' })

    const hits = await searchHits({ query: 'iframe crash', scope: 'other_tasks' })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      sessionId: sibling.id,
      taskId: 'sibling',
      match: 'assistant_message',
      seq: head.seq,
      read: { sessionId: sibling.id, aroundSeq: head.seq, view: 'conversation' },
    })
    expect(hits[0]!.excerpt).toContain('<pasted_content')

    const withTools = await searchHits({ query: 'iframe crash', roles: ['tool'] })
    expect(withTools.map((hit) => [hit.match, hit.read.view])).toEqual([['tool_text', 'with_tools']])
    expect((await searchHits({ query: 'iframe crash', includeCurrentSession: true, scope: 'task' }))[0]).toMatchObject({
      sessionId: callerId,
    })
    expect(await searchHits({ query: 'hidden thoughts' })).toEqual([])
    expect(await searchHits({ query: 'iframe', sessionId: foreign.id })).toEqual([])

    const titled = await searchHits({ query: 'renderer' })
    expect(titled).toEqual([expect.objectContaining({ match: 'title', read: { sessionId: sibling.id } })])
    expect(titled[0]).not.toHaveProperty('seq')
  })

  it('continues with a cursor without repeating hits', async () => {
    const sibling = await session('sibling')
    for (let index = 0; index < 5; index += 1)
      await store.recordEvent(sibling.id, null, { type: 'user_message', text: `needle ${index}` })
    const first = (await tools().search.handler({ query: 'needle', limit: 3 }, claim)) as {
      hits: Hit[]
      nextCursor: string
    }
    const second = (await tools().search.handler({ query: 'needle', limit: 3, cursor: first.nextCursor }, claim)) as {
      hits: Hit[]
      nextCursor: string | null
    }
    expect([...first.hits, ...second.hits].map((hit) => hit.seq).sort()).toEqual([1, 2, 3, 4, 5])
    expect(second.nextCursor).toBeNull()
    await expect(tools().search.handler({ query: 'other words', cursor: first.nextCursor }, claim)).rejects.toThrow(
      'cursor',
    )
  })

  it('says an empty result is empty, and lexical', async () => {
    const result = (await tools().search.handler({ query: 'nothing here' }, claim)) as { hits: Hit[]; note: string }
    expect(result.hits).toEqual([])
    expect(result.note).toMatch(/No matches.*paraphrase/)
  })
})

describe('agent_session_read', () => {
  it('reads by ID alone, folds streamed fragments, and keeps hidden and internal content out', async () => {
    const sibling = await session('sibling', 'Retention')
    await store.recordEvent(sibling.id, 'turn', { type: 'user_message', text: 'How long do we keep transcripts?' })
    await store.recordEvent(sibling.id, 'turn', { type: 'reasoning', text: 'private reasoning' })
    await store.recordEvent(sibling.id, 'turn', {
      type: 'assistant_message',
      append: true,
      messageId: 'm',
      text: 'Ninety ',
    })
    await store.recordEvent(sibling.id, 'turn', {
      type: 'assistant_message',
      append: true,
      messageId: 'm',
      text: 'days.',
    })
    await store.recordEvent(sibling.id, 'turn', {
      type: 'tool',
      tool: { id: 't', name: 'Bash', title: 'run tests', input: 'pnpm test', output: 'ok', status: 'completed' },
    })
    await store.recordEvent(sibling.id, 'turn', { type: 'error', code: 'rate', message: 'Slow down', retryable: true })
    await store.recordEvent(sibling.id, 'turn', { type: 'session_state', state: 'working' })

    const read = await readThread({ sessionId: sibling.id })
    expect(read.session).toMatchObject({ sessionId: sibling.id, taskId: 'sibling' })
    expect(read.items.map((item) => [item.role, item.fromSeq, item.toSeq])).toEqual([
      ['user', 1, 1],
      ['assistant', 3, 4],
      ['error', 6, 6],
    ])
    expect(read.items[1]!.text).toContain('Ninety days.')
    expect(JSON.stringify(read)).not.toContain('private reasoning')
    expect(JSON.stringify(read)).not.toContain('pnpm test')

    const withTools = await readThread({ sessionId: sibling.id, view: 'with_tools' })
    expect(withTools.items.map((item) => item.role)).toEqual(['user', 'assistant', 'tool', 'error'])
    expect(withTools.items[2]!.text).toContain('pnpm test')
  })

  it('reads around a search hit and continues with cursors in both directions', async () => {
    const sibling = await session('sibling')
    for (let index = 1; index <= 30; index += 1)
      await store.recordEvent(sibling.id, null, { type: 'user_message', text: `message ${index}` })
    const around = await readThread({ sessionId: sibling.id, aroundSeq: 15, limit: 6 })
    expect(around.items.map((item) => item.fromSeq)).toEqual([12, 13, 14, 15, 16, 17])
    const next = await readThread({ sessionId: sibling.id, cursor: around.nextCursor, limit: 6 })
    expect(next.items.map((item) => item.fromSeq)).toEqual([18, 19, 20, 21, 22, 23])
    const previous = await readThread({ sessionId: sibling.id, cursor: around.previousCursor, limit: 6 })
    expect(previous.items.map((item) => item.fromSeq)).toEqual([6, 7, 8, 9, 10, 11])

    const recent = await readThread({ sessionId: sibling.id, limit: 3 })
    expect(recent.items.map((item) => item.fromSeq)).toEqual([28, 29, 30])
    expect(recent.nextCursor).toBeNull()
    const beginning = await readThread({ sessionId: sibling.id, start: 'beginning', limit: 2 })
    expect(beginning.items.map((item) => item.fromSeq)).toEqual([1, 2])
    expect(beginning.previousCursor).toBeNull()
  })

  it('keeps a captured read to its boundary while the session goes on', async () => {
    const sibling = await session('sibling')
    for (let index = 1; index <= 4; index += 1)
      await store.recordEvent(sibling.id, null, { type: 'user_message', text: `before ${index}` })
    const first = await readThread({ sessionId: sibling.id, start: 'beginning', limit: 2 })
    expect(first.boundarySeq).toBe(4)
    await store.recordEvent(sibling.id, null, { type: 'user_message', text: 'after the capture' })
    const rest = await readThread({ sessionId: sibling.id, cursor: first.nextCursor, limit: 10 })
    expect(rest.items.map((item) => item.fromSeq)).toEqual([3, 4])
    expect(rest.nextCursor).toBeNull()
    expect(rest.boundarySeq).toBe(4)
  })

  it('splits a long message across pages under the response cap without losing text', async () => {
    const sibling = await session('sibling')
    const long = `${'a'.repeat(50_000)}${'b'.repeat(50_000)}${'c'.repeat(50_000)}`
    await store.recordEvent(sibling.id, null, { type: 'user_message', text: long })
    await store.recordEvent(sibling.id, null, { type: 'user_message', text: 'after' })
    let page = await readThread({ sessionId: sibling.id, start: 'beginning' })
    const pieces: string[] = []
    const bodies: string[] = []
    for (;;) {
      expect(Buffer.byteLength(JSON.stringify(page, null, 2))).toBeLessThanOrEqual(READ_RESPONSE_MAX_BYTES)
      for (const item of page.items) {
        const body = item.text.replace(/^<pasted_content[^>]*>\n/, '').replace(/\n<\/pasted_content[^>]*>$/, '')
        if (item.fromSeq === 1) pieces.push(body)
        else bodies.push(body)
      }
      if (!page.nextCursor) break
      page = await readThread({ sessionId: sibling.id, cursor: page.nextCursor })
    }
    expect(pieces.length).toBeGreaterThan(2)
    expect(pieces.join('')).toBe(long)
    expect(bodies).toEqual(['after'])
  })

  it('answers not_found alike for missing and other-project sessions, and refuses forged cursors', async () => {
    const foreign = await session('foreign')
    await store.recordEvent(foreign.id, null, { type: 'user_message', text: 'secret' })
    await expect(readThread({ sessionId: foreign.id })).rejects.toMatchObject({ kind: 'not_found' })
    await expect(readThread({ sessionId: 'missing' })).rejects.toMatchObject({ kind: 'not_found' })

    const sibling = await session('sibling')
    await store.recordEvent(sibling.id, null, { type: 'user_message', text: 'hello' })
    const page = await readThread({ sessionId: sibling.id, start: 'beginning', limit: 1 })
    await expect(readThread({ sessionId: foreign.id, cursor: page.previousCursor ?? 'x' })).rejects.toThrow()
    const forged = Buffer.from(
      JSON.stringify({ k: 'read', s: sibling.id, w: 'conversation', b: 99, d: 'next', q: 1, o: 0 }),
    ).toString('base64url')
    await expect(readThread({ sessionId: sibling.id, cursor: forged })).rejects.toThrow('cursor')
    await expect(readThread({ sessionId: sibling.id, start: 'beginning', aroundSeq: 1 })).rejects.toThrow('at most one')
  })

  it('reports removed history, treats an empty session as empty, and changes nothing it reads', async () => {
    const empty = await session('sibling')
    expect((await readThread({ sessionId: empty.id })).items).toEqual([])

    const removed = await session('old')
    await store.recordEvent(removed.id, null, { type: 'user_message', text: 'gone soon' })
    const before = await store.getSession(removed.id)
    const read = await readThread({ sessionId: removed.id })
    expect(read.items).toHaveLength(1)
    expect(await store.getSession(removed.id)).toEqual(before)

    await store.finishHistoryRemoval(removed.id, 'History removed by retention.')
    expect(await readThread({ sessionId: removed.id })).toMatchObject({ history: 'removed', items: [] })
  })
})

describe('pageThread', () => {
  it('resumes inside an item that does not fit, rather than dropping it', () => {
    const item = { role: 'assistant' as const, time: 0, fromSeq: 7, toSeq: 9, text: 'x'.repeat(10_000) }
    const page = pageThread({}, [item], 0, null, 6_000)
    expect(page.resume).toMatchObject({ seq: 7 })
    expect(page.resume!.offset).toBeGreaterThan(0)
    expect(page.resume!.offset).toBeLessThan(10_000)
  })
})
