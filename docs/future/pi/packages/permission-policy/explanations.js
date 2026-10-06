// The optional explanation: after this plugin's veto has taken effect, one note to the agent saying
// what was refused and why. Off until the person turns it on.
//
// The veto route only records the work. Delivery waits for proof the veto stuck: the resolved request
// row in `agents.requests` with `blocked.by` naming this plugin. A verdict the host ignored after its
// timeout, or a request another plugin blocked first, never has that row, so it is never explained.

export const PLUGIN_ID = 'acorn-permission-policy'

// A recorded refusal whose request row never appeared, such as a session deleted meanwhile, is dropped
// once it's this old. Younger ones may still be on their way to the database.
const FORGET_MISSING_AFTER_MS = 60_000

/** `db` is a SQLite client with `prepare`. `requests` is the `agents.requests` capability, or null. */
export function createExplanations({ db, requests, now = Date.now }) {
  let sender = null

  const enabled = () => db.prepare('SELECT value FROM settings WHERE key = ?').get('explain')?.value === 'on'
  const setEnabled = (on) => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('explain', on ? 'on' : 'off')
  }
  const forget = (row) => {
    db.prepare('DELETE FROM explanations WHERE session_id = ? AND request_id = ?').run(row.session_id, row.request_id)
  }

  /** Called from the veto route. Records work and sends nothing. */
  function refused(payload) {
    if (!enabled()) return
    db.prepare('INSERT OR IGNORE INTO explanations (session_id, request_id, task_id, created_at) VALUES (?, ?, ?, ?)')
      .run(payload.sessionId, payload.requestId, payload.taskId, now())
  }

  async function deliver(row) {
    const list = requests?.() ?? null
    if (!sender || !list) return
    const request = (await list.list({ taskId: row.task_id, sessionId: row.session_id }))
      .find((candidate) => candidate.requestId === row.request_id)
    if (!request) {
      if (now() - row.created_at > FORGET_MISSING_AFTER_MS) forget(row)
      return
    }
    if (request.status !== 'resolved' && request.status !== 'expired') return
    // Somebody else's veto, a late verdict the host ignored, or the person's own answer.
    if (request.blocked?.by !== PLUGIN_ID) return forget(row)
    // A thrown error leaves the row for the next pass. Any answer, including a refusal, is final, and
    // the host's idempotency key makes a repeated send return the first note.
    await sender.queue({
      taskId: row.task_id,
      sessionId: row.session_id,
      subject: 'permission refused',
      idempotencyKey: `${row.session_id}:${row.request_id}`,
      text: [
        `The permission request "${request.title}" was refused by a rule in the ${PLUGIN_ID} plugin: ${request.blocked.reason}`,
        'The command did not run. Do not retry it in another form to get around the rule. If the work needs it, ask the person to run it or to change the policy.',
      ].join('\n\n'),
    })
    forget(row)
  }

  /** The resolved `plugin:agents:request-changed` frame for one request. */
  async function requestChanged(frame) {
    if (frame.status !== 'resolved') return
    const row = db.prepare('SELECT * FROM explanations WHERE session_id = ? AND request_id = ?').get(frame.sessionId, frame.requestId)
    if (row) await deliver(row)
  }

  /** Every recorded refusal, for a sender that just connected. This is what covers a missed event. */
  async function deliverAll() {
    for (const row of db.prepare('SELECT * FROM explanations ORDER BY created_at').all()) await deliver(row)
  }

  return {
    enabled,
    setEnabled,
    refused,
    requestChanged,
    connect: async (given) => {
      sender = given
      await deliverAll()
    },
  }
}
