import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { replayFixture } from './replay-fixtures.mjs'

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function createReplayState(dataDir) {
  const db = new DatabaseSync(join(dataDir, 'plugins', 'agents.sqlite'), { readOnly: true })
  const session = db.prepare("select id from agent_sessions where provider_id = 'streaming-replay:replay' order by created_at desc limit 1")
  const turn = db.prepare('select id, status, error_json from agent_turns where session_id = ? order by ordinal desc limit 1')
  const events = db.prepare('select event_json from agent_events where session_id = ? and turn_id = ? order by seq')
  return {
    async waitTurn(name, seed, timeoutMs) {
      const expected = replayFixture(name, seed)
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const selected = session.get()
        const latest = selected && turn.get(selected.id)
        if (latest && ['completed', 'failed', 'cancelled', 'interrupted'].includes(latest.status)) {
          if (latest.status !== 'completed') throw new Error(`Replay turn ${latest.status}: ${latest.error_json ?? ''}`)
          const text = events.all(selected.id, latest.id).map((row) => JSON.parse(row.event_json))
            .filter((event) => event.type === 'assistant_message').map((event) => event.text).join('')
          const digest = createHash('sha256').update(text).digest('hex')
          if (digest !== expected.digest) throw new Error(`Replay digest mismatch for ${name}: ${digest} instead of ${expected.digest} (${Buffer.byteLength(text)} bytes).`)
          return { sessionId: selected.id, turnId: latest.id, digest, bytes: Buffer.byteLength(text), expectedBytes: expected.bytes }
        }
        await pause(200)
      }
      throw new Error(`Replay turn did not complete within ${timeoutMs}ms.`)
    },
    close: () => db.close(),
  }
}
