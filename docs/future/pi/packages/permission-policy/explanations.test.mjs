// Run with `node --test` from this folder.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createExplanations, PLUGIN_ID } from './explanations.js'

const database = () => {
  const db = new DatabaseSync(':memory:')
  for (const statement of readFileSync(new URL('./migrations/0000_init.sql', import.meta.url), 'utf8').split('--> statement-breakpoint')) {
    db.exec(statement)
  }
  return db
}

// One session with one request, whose row the test edits, and a sender that records what it's asked.
const setup = ({ on = true } = {}) => {
  const db = database()
  const row = { requestId: 'r1', turnId: 'turn-1', status: 'resolved', title: 'Bash: git push --force', blocked: { by: PLUGIN_ID, reason: 'No force-push.' } }
  const sent = []
  const sender = { queue: async (message) => { sent.push(message); return { ok: true, turnId: 't1' } } }
  const requests = { list: async ({ sessionId }) => (sessionId === 's1' && row ? [row] : []) }
  const logged = []
  const explanations = createExplanations({ db, requests: () => requests, log: (line) => logged.push(line) })
  explanations.setEnabled(on)
  const pending = () => db.prepare('SELECT count(*) AS n FROM explanations').get().n
  return { db, row, sent, sender, explanations, pending, logged }
}
const payload = { sessionId: 's1', taskId: 'task', requestId: 'r1' }
const resolved = { sessionId: 's1', taskId: 'task', requestId: 'r1', status: 'resolved' }

test('records nothing while the switch is off, which is the default', () => {
  const db = database()
  const explanations = createExplanations({ db, requests: () => null })
  assert.equal(explanations.enabled(), false)
  explanations.refused(payload)
  assert.equal(db.prepare('SELECT count(*) AS n FROM explanations').get().n, 0)
})

test('explains a confirmed veto once, keyed by the provider request id', async () => {
  const { sent, sender, explanations, pending } = setup()
  await explanations.connect(sender)
  explanations.refused(payload)
  explanations.refused(payload)
  assert.equal(pending(), 1)
  await explanations.requestChanged(resolved)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].idempotencyKey, 's1:r1')
  assert.equal(sent[0].subject, 'permission refused')
  assert.match(sent[0].text, /"Bash: git push --force" was refused .*: No force-push\./)
  assert.equal(pending(), 0)
})

test('never explains a veto it did not make stick', async () => {
  for (const blocked of [{ by: 'other-policy', reason: 'Nope.' }, undefined]) {
    // Another plugin's veto, or this plugin's late verdict ignored and the person answered.
    const { row, sent, sender, explanations, pending } = setup()
    row.blocked = blocked
    await explanations.connect(sender)
    explanations.refused(payload)
    await explanations.requestChanged(resolved)
    assert.deepEqual(sent, [])
    assert.equal(pending(), 0)
  }
})

test('waits for the resolved row, and catches up on connect after a missed event', async () => {
  const { row, sent, sender, explanations, pending } = setup()
  row.status = 'pending'
  explanations.refused(payload)
  await explanations.connect(sender)
  assert.deepEqual(sent, [])
  assert.equal(pending(), 1)
  // The resolved event is lost, as across a restart. The next connect reads the committed row.
  row.status = 'resolved'
  await explanations.connect(sender)
  assert.equal(sent.length, 1)
})

test('keeps the work when the send fails, and a failed send leaves the veto alone', async () => {
  const { sent, sender, explanations, pending } = setup()
  explanations.refused(payload)
  await assert.rejects(explanations.connect({ queue: async () => { throw new Error('revoked') } }))
  assert.equal(pending(), 1)
  await explanations.connect(sender)
  assert.equal(sent.length, 1)
  assert.equal(pending(), 0)
})

test('names the refused turn, so a workflow or delegated note joins its operation', async () => {
  const { sent, sender, explanations } = setup()
  explanations.refused(payload)
  await explanations.connect(sender)
  assert.equal(sent[0].originTurnId, 'turn-1')
})

test('records a host refusal, such as a finished operation, as final', async () => {
  const { explanations, pending, logged } = setup()
  explanations.refused(payload)
  await explanations.connect({ queue: async () => ({ ok: false, reason: 'operation-closed' }) })
  assert.equal(pending(), 0)
  assert.deepEqual(logged, ['the refusal of request r1 was not explained: the host answered operation-closed'])
})
