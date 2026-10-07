// The advisor's durable review jobs. One job per completed turn, keyed by session and turn. An event
// is a nudge to look, never the record itself: each job reads the turn's state again before it
// spends, and again after, before it sends anything.

import { buildPrompt, decide, MAX_DIFF_BYTES, noteText, parseVerdict, SYSTEM } from './review.js'

export const PLUGIN_ID = 'acorn-advisor'
// Two reviews at once across every session. A third waits its turn in the table.
const MAX_RUNNING = 2
const MAX_OUTPUT_TOKENS = 800

/**
 * `db` is a SQLite client with `prepare`. `reviewInput`, `turns` and `sessions` return the agents
 * capability or undefined, read at call time. `tasks`, `git`, `models` and `identity` are the granted
 * `ctx.core` facets.
 */
export function createAdvisor({ db, reviewInput, turns, sessions, tasks, git, models, identity, now = Date.now }) {
  let sender = null
  let stopped = false
  // Job key to its AbortController, for the jobs this process is running.
  const running = new Map()
  const key = (job) => `${job.session_id}:${job.turn_id}`

  const setting = (name) => db.prepare('SELECT value FROM settings WHERE key = ?').get(name)?.value ?? null
  const setSetting = (name, value) => db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(name, value)
  const enabled = () => setting('mode') === 'interactive'
  const setJob = (job, status, reason = null) => db.prepare(
    'UPDATE jobs SET status = ?, reason = ?, updated_at = ? WHERE session_id = ? AND turn_id = ?',
  ).run(status, reason, now(), job.session_id, job.turn_id)

  // A job this process can't have started. Running ones from an earlier process may have spent on a
  // model call, so they're recorded as interrupted and never retried.
  db.prepare("UPDATE jobs SET status = 'interrupted', reason = 'the Node stopped during the review', updated_at = ? WHERE status = 'running'").run(now())

  function pump() {
    while (!stopped && running.size < MAX_RUNNING && enabled()) {
      const job = db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get()
      if (!job) return
      const controller = new AbortController()
      running.set(key(job), controller)
      setJob(job, 'running')
      // `run` records its own failures. This catch is for a write after shutdown closed the database.
      void run(job, controller.signal).catch(() => undefined).finally(() => {
        running.delete(key(job))
        pump()
      })
    }
  }

  async function run(job, signal) {
    try {
      const reason = await review(job, signal)
      setJob(job, signal.aborted ? 'cancelled' : 'done', reason ?? null)
      if (!signal.aborted) setSetting('problem', '')
    } catch (error) {
      if (signal.aborted) return setJob(job, 'cancelled', 'stopped while reviewing')
      const reason = error?.code ? `${error.code}: ${error.message}` : String(error?.message ?? error)
      setJob(job, 'failed', reason)
      // What the settings page shows until a review gets through, such as a missing model grant.
      setSetting('problem', reason)
    }
  }

  /** One review. Returns why it sent nothing, or null once a note is delivered or recorded. */
  async function review(job, signal) {
    const reader = reviewInput(), turnList = turns(), roster = sessions()
    if (!reader || !turnList || !roster) return 'the agents plugin is off, or its review reader is missing'
    const ref = { taskId: job.task_id, sessionId: job.session_id, turnId: job.turn_id }

    const session = (await roster.list(job.task_id)).find((entry) => entry.sessionId === job.session_id)
    if (!session || session.archived) return 'session gone'
    if (session.kind !== 'interactive') return 'not an interactive session'
    const read = await reader.read(ref)
    if (!read.available) return `turn ${read.reason}`

    const diff = await workingTree(job.task_id, signal)
    if (signal.aborted) return null
    const result = await models.generateText({
      // No backend: the owner's grant for this plugin decides which, and caps it.
      userId: identity.active(),
      input: { system: SYSTEM, prompt: buildPrompt(read.input, diff), maxOutputTokens: MAX_OUTPUT_TOKENS, signal },
    })
    if (signal.aborted) return null
    const verdict = parseVerdict(result.text)
    if (!verdict) return 'the model\'s answer was not one valid verdict'

    // Read again now, not before: the person may have moved on, stopped, or archived while we waited.
    const list = await turnList.list({ taskId: job.task_id, sessionId: job.session_id })
    const turn = list.find((entry) => entry.turnId === job.turn_id)
    const latest = list.at(-1)
    const after = (await roster.list(job.task_id)).find((entry) => entry.sessionId === job.session_id)
    const history = db.prepare('SELECT severity, note, outcome, ordinal FROM notes WHERE session_id = ? ORDER BY created_at').all(job.session_id)
    const decision = decide({ verdict, history, turn: { ...turn, turnId: job.turn_id }, latest, session: after })
    if (decision.outcome === 'none') return 'nothing to say'

    let outcome = decision.outcome === 'deliver' ? 'delivered' : decision.outcome
    let reason = decision.reason ?? null
    if (decision.outcome === 'deliver') {
      if (!sender) {
        outcome = 'recorded'
        reason = 'no messenger connected'
      } else {
        const sent = await sender.queue({
          ...ref, subject: `advisor ${verdict.severity}`, text: noteText(verdict), idempotencyKey: `${job.session_id}:${job.turn_id}`,
        })
        if (!sent.ok) {
          outcome = 'recorded'
          reason = sent.reason
        }
      }
    }
    db.prepare(`INSERT OR REPLACE INTO notes (session_id, turn_id, task_id, ordinal, severity, note, outcome, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(job.session_id, job.turn_id, job.task_id, turn?.ordinal ?? 0, verdict.severity, verdict.note, outcome, reason, now())
    return null
  }

  // A snapshot of the task's working tree, not proof of what this turn changed.
  async function workingTree(taskId, signal) {
    const root = await tasks.root(taskId)
    if (!root) return { available: false }
    try {
      const stat = await git.gitText(['diff', '--stat', 'HEAD'], { cwd: root, signal })
      const patch = await git.git(['diff', 'HEAD'], { cwd: root, signal, maxOutputBytes: MAX_DIFF_BYTES })
      return { available: true, stat, patch: patch.stdout, truncated: patch.truncated }
    } catch {
      return { available: false }
    }
  }

  function cancel(match) {
    for (const [jobKey, controller] of running) if (match(jobKey)) controller.abort()
  }

  return {
    /** `plugin:agents:turn-changed`. Interactive turns only in this version. */
    turnChanged(frame) {
      if (!enabled() || frame.status !== 'completed') return
      // A plugin's note and a delegated agent's report aren't the person's work. Reviewing them would
      // also let the advisor answer itself.
      if (frame.source !== 'interactive') return
      db.prepare(`INSERT OR IGNORE INTO jobs (session_id, turn_id, task_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'queued', ?, ?)`).run(frame.sessionId, frame.turnId, frame.taskId, now(), now())
      pump()
    },
    /** `plugin:agents:sessions-changed`. An archived or deleted session's reviews stop. */
    sessionsChanged(frame) {
      if (!frame.archived && frame.present) return
      db.prepare("UPDATE jobs SET status = 'cancelled', reason = 'session archived', updated_at = ? WHERE session_id = ? AND status = 'queued'").run(now(), frame.sessionId)
      cancel((jobKey) => jobKey.startsWith(`${frame.sessionId}:`))
    },
    connect(given) {
      sender = given
      pump()
    },
    mode: () => (enabled() ? 'interactive' : 'off'),
    setMode(mode) {
      setSetting('mode', mode)
      if (mode === 'off') {
        db.prepare("UPDATE jobs SET status = 'cancelled', reason = 'advisor turned off', updated_at = ? WHERE status = 'queued'").run(now())
        cancel(() => true)
      } else pump()
    },
    status: () => ({
      mode: enabled() ? 'interactive' : 'off',
      problem: setting('problem') || null,
      reviewsToday: db.prepare("SELECT count(*) AS n FROM jobs WHERE status = 'done' AND updated_at >= ?").get(startOfDay(now())).n,
      notes: db.prepare('SELECT task_id AS taskId, severity, note, outcome, reason, created_at AS createdAt FROM notes ORDER BY created_at DESC LIMIT 20').all(),
    }),
    /** Shutdown: stop every running review and start no more. Queued jobs resume on the next boot. */
    dispose() {
      stopped = true
      cancel(() => true)
    },
  }
}

const startOfDay = (at) => {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
