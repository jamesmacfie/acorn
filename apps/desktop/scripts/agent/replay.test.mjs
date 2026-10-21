import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { replayFixture } from './replay-fixtures.mjs'
import { startLoad, takeLoadFlag } from './replay-load.mjs'
import { replayProcessIds } from './replay-resources.mjs'
import { createReplayState } from './replay-state.mjs'

describe('generated replay fixtures', () => {
  it('covers long prose, an open code fence, and 30 completed tool cards', () => {
    const prose = replayFixture('prose')
    const code = replayFixture('code')
    const tools = replayFixture('tools')
    expect(prose.bytes).toBeGreaterThan(50_000)
    expect(code.updates[0].content.text).toBe('```ts\n')
    expect(code.updates.at(-1).content.text).toBe('```\n')
    expect(code.updates.filter((update) => update.sessionUpdate === 'agent_message_chunk')).toHaveLength(302)
    expect(tools.updates.filter((update) => update.sessionUpdate === 'tool_call')).toHaveLength(30)
    expect(tools.updates.filter((update) => update.sessionUpdate === 'tool_call_update')).toHaveLength(30)
    expect(replayFixture('prose').digest).toBe(prose.digest)
    expect(replayFixture('prose', 2).digest).not.toBe(prose.digest)
  })

  it('attributes four distinct processes from the shell tree and WebKit diagnostic', () => {
    const rows = [
      { pid: 20, parent: 10, command: '/node/helper' },
      { pid: 30, parent: 20, command: '/node/service' },
      { pid: 40, parent: 1, command: 'WebKit.WebContent' },
    ]
    expect(replayProcessIds(rows, 10, 40)).toEqual({ shell: 10, helper: 20, node: 30, renderer: 40 })
    expect(() => replayProcessIds(rows, 10, null)).toThrow(/Could not identify/)
  })
})

describe('loading the machine', () => {
  it('reads --load with a count, with none, or not at all', () => {
    expect(takeLoadFlag(['prose', '--load', '3'])).toEqual({ args: ['prose'], load: 3 })
    expect(takeLoadFlag(['--load', 'prose'])).toEqual({ args: ['prose'], load: cpus().length })
    expect(takeLoadFlag(['--fixture', 'agents', '--load'])).toEqual({ args: ['--fixture', 'agents'], load: cpus().length })
    expect(takeLoadFlag(['prose'])).toEqual({ args: ['prose'], load: 0 })
    expect(() => takeLoadFlag(['prose', '--load', '0'])).toThrow(/at least 1/)
  })

  it('starts the busy processes and stops every one', async () => {
    const busy = startLoad(2)
    expect(busy.pids).toHaveLength(2)
    for (const pid of busy.pids) expect(() => process.kill(pid, 0)).not.toThrow()
    await busy.stop()
    for (const pid of busy.pids) expect(() => process.kill(pid, 0)).toThrow()
  })
})

let directory
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

async function ledger(sessions) {
  directory = await mkdtemp(join(tmpdir(), 'acorn-replay-ledger-'))
  await mkdir(join(directory, 'plugins'))
  const db = new DatabaseSync(join(directory, 'plugins', 'agents.sqlite'))
  db.exec('create table agent_sessions (id text, provider_id text, created_at integer); create table agent_turns (id text, session_id text, status text, error_json text, ordinal integer); create table agent_events (session_id text, turn_id text, seq integer, event_json text)')
  sessions.forEach(({ status, text }, index) => {
    const id = `s${index + 1}`
    db.prepare('insert into agent_sessions values (?, ?, ?)').run(id, 'streaming-replay:replay', index + 1)
    db.prepare('insert into agent_turns values (?, ?, ?, ?, ?)').run(`t${index + 1}`, id, status, null, 1)
    db.prepare('insert into agent_events values (?, ?, ?, ?)').run(id, `t${index + 1}`, 1, JSON.stringify({ type: 'assistant_message', text }))
  })
  db.close()
  return createReplayState(directory)
}

const toolsText = () => replayFixture('tools').updates
  .filter((update) => update.sessionUpdate === 'agent_message_chunk').map((update) => update.content.text).join('')

it('rejects a completed replay whose ledger text differs from the fixture', async () => {
  const state = await ledger([{ status: 'completed', text: 'wrong' }])
  try {
    await expect(state.waitTurns('tools', 1, 100)).rejects.toThrow(/digest mismatch/)
  } finally {
    state.close()
  }
})

it('waits for every one of the newest sessions to finish', async () => {
  const state = await ledger([
    { status: 'completed', text: toolsText() },
    { status: 'working', text: '' },
    { status: 'completed', text: toolsText() },
  ])
  try {
    await expect(state.waitTurns('tools', 1, 300, 3)).rejects.toThrow(/3 replay turns did not complete/)
    expect((await state.waitTurns('tools', 1, 300, 1)).map((turn) => turn.sessionId)).toEqual(['s3'])
  } finally {
    state.close()
  }
})
