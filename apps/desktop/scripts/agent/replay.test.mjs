import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { replayFixture } from './replay-fixtures.mjs'
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

let directory
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

it('rejects a completed replay whose ledger text differs from the fixture', async () => {
  directory = await mkdtemp(join(tmpdir(), 'acorn-replay-ledger-'))
  await mkdir(join(directory, 'plugins'))
  const db = new DatabaseSync(join(directory, 'plugins', 'agents.sqlite'))
  db.exec('create table agent_sessions (id text, provider_id text, created_at integer); create table agent_turns (id text, session_id text, status text, error_json text, ordinal integer); create table agent_events (session_id text, turn_id text, seq integer, event_json text)')
  db.prepare('insert into agent_sessions values (?, ?, ?)').run('s1', 'streaming-replay:replay', 1)
  db.prepare('insert into agent_turns values (?, ?, ?, ?, ?)').run('t1', 's1', 'completed', null, 1)
  db.prepare('insert into agent_events values (?, ?, ?, ?)').run('s1', 't1', 1, JSON.stringify({ type: 'assistant_message', text: 'wrong' }))
  db.close()
  const state = createReplayState(directory)
  try {
    await expect(state.waitTurn('tools', 1, 100)).rejects.toThrow(/digest mismatch/)
  } finally {
    state.close()
  }
})
