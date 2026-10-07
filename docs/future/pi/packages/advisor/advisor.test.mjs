// Run with `node --test` from this folder.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { createAdvisor } from './advisor.js'

const database = () => {
  const db = new DatabaseSync(':memory:')
  for (const statement of readFileSync(new URL('./migrations/0000_init.sql', import.meta.url), 'utf8').split('--> statement-breakpoint')) {
    db.exec(statement)
  }
  return db
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

// One interactive session in one task. The test edits the turn list, the session row, and what the
// model answers, and counts every paid call and every note sent.
const setup = ({ mode = 'interactive', db = database(), answer = '{"severity":"blocker","note":"`rm -rf build` deletes the cache."}' } = {}) => {
  const world = {
    turns: [{ turnId: 'u1', ordinal: 1, status: 'completed', stopReason: 'end_turn' }],
    session: { sessionId: 's1', kind: 'interactive', archived: false, runtimeState: 'ready' },
    answer,
    generated: [],
    sent: [],
    hold: null,
  }
  const advisor = createAdvisor({
    db,
    reviewInput: () => ({ read: async () => ({ available: true, input: { userText: [{ text: 'Clean up.', provenance: { kind: 'person' }, truncated: false }], userTextTruncated: false, finalText: 'Done.', finalTextTruncated: false } }) }),
    turns: () => ({ list: async () => world.turns }),
    sessions: () => ({ list: async () => [world.session] }),
    tasks: { root: async () => null },
    git: {},
    identity: { active: () => 'owner-1' },
    models: {
      generateText: async (request) => {
        world.generated.push(request)
        if (world.hold) await world.hold(request)
        if (typeof world.answer !== 'string') throw world.answer
        return { text: world.answer }
      },
    },
  })
  if (mode) advisor.setMode(mode)
  advisor.connect({ queue: async (message) => { world.sent.push(message); return { ok: true, turnId: 'n1' } } })
  const completed = (turnId = 'u1', source = 'interactive') => advisor.turnChanged({ taskId: 't1', sessionId: 's1', turnId, source, status: 'completed', attempt: 1 })
  const notes = () => db.prepare('SELECT severity, outcome, reason FROM notes ORDER BY created_at').all().map((row) => ({ ...row }))
  const job = (turnId = 'u1') => ({ ...db.prepare('SELECT status, reason FROM jobs WHERE turn_id = ?').get(turnId) })
  return { db, world, advisor, completed, notes, job }
}

test('off by default and while off, nothing is queued or spent', async () => {
  const { world, completed, job } = setup({ mode: null })
  completed()
  await settle()
  assert.deepEqual(world.generated, [])
  assert.deepEqual(job(), {})
})

test('sends a blocker once, keyed by the turn, however often the event repeats', async () => {
  const { world, completed, notes, job } = setup()
  completed()
  completed()
  await settle()
  completed()
  await settle()
  assert.equal(world.generated.length, 1)
  assert.equal(world.generated[0].backendId, undefined)
  assert.equal(world.generated[0].userId, 'owner-1')
  assert.match(world.generated[0].input.prompt, /<data id="[0-9a-f]+" title="request">\nThe person:\nClean up\./)
  assert.equal(world.sent.length, 1)
  assert.equal(world.sent[0].idempotencyKey, 's1:u1')
  assert.equal(world.sent[0].subject, 'advisor blocker')
  assert.deepEqual(notes(), [{ severity: 'blocker', outcome: 'delivered', reason: null }])
  assert.deepEqual(job(), { status: 'done', reason: null })
})

test('never reviews a plugin note, a delegated report, or an unfinished turn', async () => {
  const { world, advisor, completed } = setup()
  completed('u2', 'plugin')
  completed('u3', 'delegation_report')
  advisor.turnChanged({ taskId: 't1', sessionId: 's1', turnId: 'u4', source: 'interactive', status: 'cancelled', attempt: 1 })
  await settle()
  assert.deepEqual(world.generated, [])
})

test('records a malformed answer and an unconfigured grant without sending, and says why', async () => {
  const { world, completed, notes, job, advisor } = setup({ answer: 'Looks fine to me!' })
  completed()
  await settle()
  assert.deepEqual(job(), { status: 'done', reason: 'the model\'s answer was not one valid verdict' })
  world.answer = Object.assign(new Error('acorn-advisor has no model to generate with.'), { code: 'provider_not_configured' })
  completed('u2')
  await settle()
  assert.equal(job('u2').status, 'failed')
  assert.match(advisor.status().problem, /^provider_not_configured/)
  assert.deepEqual(world.sent, [])
  assert.deepEqual(notes(), [])
})

test('drops a repeated note, and lets a real escalation through', async () => {
  const { world, completed, notes } = setup({ answer: '{"severity":"nit","note":"Rename x."}' })
  completed('u1')
  await settle()
  world.turns.push({ turnId: 'u2', ordinal: 2, status: 'completed', stopReason: 'end_turn' })
  completed('u2')
  await settle()
  world.answer = '{"severity":"blocker","note":"Rename   X."}'
  world.turns.push({ turnId: 'u3', ordinal: 3, status: 'completed', stopReason: 'end_turn' })
  completed('u3')
  await settle()
  assert.deepEqual(notes().map((note) => note.outcome), ['recorded', 'suppressed', 'delivered'])
})

test('holds a mid-work concern during the cooldown and a finished-answer concern always', async () => {
  const { world, completed, notes } = setup({ answer: '{"severity":"concern","note":"The test is skipped."}' })
  world.turns[0].stopReason = 'max_tokens'
  completed('u1')
  await settle()
  world.answer = '{"severity":"concern","note":"The migration has no down step."}'
  world.turns.push({ turnId: 'u2', ordinal: 2, status: 'completed', stopReason: 'max_tokens' })
  completed('u2')
  await settle()
  world.answer = '{"severity":"concern","note":"Another thing entirely."}'
  world.turns.push({ turnId: 'u3', ordinal: 3, status: 'completed', stopReason: 'end_turn' })
  completed('u3')
  await settle()
  assert.deepEqual(notes().map(({ outcome, reason }) => [outcome, reason]), [['delivered', null], ['recorded', 'cooldown'], ['recorded', 'finished']])
  assert.equal(world.sent.length, 1)
})

test('checks again after generating: a stopped or moved-on session gets no note', async () => {
  const { world, completed, notes } = setup()
  world.hold = async () => { world.turns.push({ turnId: 'u2', ordinal: 2, status: 'cancelled', stopReason: null }) }
  completed('u1')
  await settle()
  world.hold = async () => { world.turns.push({ turnId: 'u4', ordinal: 4, status: 'queued', stopReason: null }) }
  world.turns.push({ turnId: 'u3', ordinal: 3, status: 'completed', stopReason: 'end_turn' })
  completed('u3')
  await settle()
  assert.deepEqual(world.sent, [])
  assert.deepEqual(notes().map((note) => note.reason), ['stopped', 'superseded'])
})

test('cancels a review in flight when turned off or the session is archived, and sends nothing late', async () => {
  for (const stop of [(advisor) => advisor.setMode('off'), (advisor) => advisor.sessionsChanged({ taskId: 't1', sessionId: 's1', present: true, archived: true, changes: ['archived'] })]) {
    const { world, advisor, completed, job } = setup()
    let started
    const generating = new Promise((resolve) => { started = resolve })
    world.hold = (request) => new Promise((resolve) => { started(); request.input.signal.addEventListener('abort', resolve) })
    completed()
    await generating
    stop(advisor)
    await settle()
    assert.equal(job().status, 'cancelled')
    assert.deepEqual(world.sent, [])
  }
})

test('after a restart, an interrupted review is never retried and a queued one runs', async () => {
  const db = database()
  const first = setup({ db })
  first.world.hold = () => new Promise(() => {})
  first.completed('u1')
  first.completed('u2')
  first.completed('u3')
  await settle()
  // Two running, one queued, and then the process is gone.
  first.advisor.dispose()
  db.prepare("UPDATE jobs SET status = 'running' WHERE turn_id IN ('u1', 'u2')").run()

  const second = setup({ db, mode: null })
  await settle()
  assert.equal(second.job('u1').status, 'interrupted')
  assert.equal(second.job('u2').status, 'interrupted')
  assert.equal(second.job('u3').status, 'done')
  assert.equal(second.world.generated.length, 1)
})
