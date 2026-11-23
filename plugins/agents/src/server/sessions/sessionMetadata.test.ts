import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'
import * as schema from '../../node/schema'
import { AgentStore } from './store'
import { FakeAgentDriver } from '../drivers/fake'

const commands = [{ name: 'review', description: 'Review the change' }]
const skills = [{ name: 'readable', description: 'Style the reply' }]

let ctx: ReturnType<typeof makeTestNodeContext>
let db: ReturnType<typeof ctx.storage.open>
let store: AgentStore
let sessionId: string

beforeEach(async () => {
  ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
  db = ctx.storage.open()
  store = new AgentStore(db, ctx.core)
  const session = await store.createSession(
    { taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} },
    await new FakeAgentDriver().probe(),
  )
  sessionId = session.id
})

afterEach(() => ctx.cleanup())

const configJson = (): string =>
  db
    .select({ configJson: schema.agentSessions.configJson })
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, sessionId))
    .get()!.configJson

const storedEvents = async () => (await store.exportSnapshot(sessionId)).events.map((record) => record.event)

it('puts a first list on the config and leaves it off the event', async () => {
  const record = await store.recordEvent(sessionId, null, { type: 'session_metadata', commands, skills })

  expect(record.event).toEqual({ type: 'session_metadata' })
  expect(await storedEvents()).toEqual([{ type: 'session_metadata' }])
  expect((await store.requireSession(sessionId)).config).toMatchObject({ commands, skills })
})

it('leaves an unchanged list off the event and does not rewrite the config', async () => {
  await store.recordEvent(sessionId, null, { type: 'session_metadata', commands })
  // Spaced out so a rewrite, even to the same values, would show in the raw column.
  const spaced = JSON.stringify(JSON.parse(configJson()), null, 2)
  db.update(schema.agentSessions).set({ configJson: spaced }).where(eq(schema.agentSessions.id, sessionId)).run()

  const record = await store.recordEvent(sessionId, null, {
    type: 'session_metadata',
    providerSessionRef: 'provider-ref',
    commands,
  })

  expect(record.event).toEqual({ type: 'session_metadata', providerSessionRef: 'provider-ref' })
  expect((await storedEvents())[1]).toEqual({ type: 'session_metadata', providerSessionRef: 'provider-ref' })
  expect(configJson()).toBe(spaced)
  expect((await store.requireSession(sessionId)).providerSessionRef).toBe('provider-ref')
})

it('updates the config with a changed list and leaves it off the event', async () => {
  await store.recordEvent(sessionId, null, { type: 'session_metadata', commands })
  const changed = [...commands, { name: 'ship' }]

  const record = await store.recordEvent(sessionId, null, { type: 'session_metadata', commands: changed })

  expect(record.event).toEqual({ type: 'session_metadata' })
  expect((await storedEvents())[1]).toEqual({ type: 'session_metadata' })
  expect((await store.requireSession(sessionId)).config).toMatchObject({ commands: changed })
})

it('keeps a changed config option on the event and drops an unchanged one', async () => {
  const options = [
    {
      id: 'model',
      label: 'Model',
      category: 'model' as const,
      currentValue: 'a',
      values: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
  ]
  const executable = { path: '/usr/local/bin/fake', version: '1.0.0' }
  await store.recordEvent(sessionId, null, { type: 'session_metadata', configOptions: options, executable })
  const switched = [{ ...options[0]!, currentValue: 'b' }]

  const record = await store.recordEvent(sessionId, null, {
    type: 'session_metadata',
    configOptions: switched,
    executable,
  })

  expect(record.event).toEqual({ type: 'session_metadata', configOptions: switched })
  expect((await storedEvents())[1]).toEqual({ type: 'session_metadata', configOptions: switched })
  expect((await store.requireSession(sessionId)).config).toMatchObject({ configOptions: switched, executable })
})
