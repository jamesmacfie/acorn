import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'
import { AgentStore } from './store'
import { sessionExecutable } from '../../shared/sessionExecutable'
import { FakeAgentDriver } from '../drivers/fake'

it('retains the launched executable across metadata updates and a store reload', async () => {
  const ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
  try {
    const store = new AgentStore(ctx.storage.open(), ctx.core)
    const session = await store.createSession(
      { taskId: randomUUID(), providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} },
      await new FakeAgentDriver().probe(),
    )
    const executable = { path: '/home/owner/.local/bin/codex', version: 'codex-cli 0.171.0' }
    await store.recordEvent(session.id, null, { type: 'session_metadata', executable })
    await store.recordEvent(session.id, null, { type: 'session_metadata', configOptions: [], commands: [] })
    const reloaded = await new AgentStore(ctx.storage.open(), ctx.core).requireSession(session.id)
    expect(sessionExecutable(reloaded)).toEqual(executable)
  } finally {
    ctx.cleanup()
  }
})
