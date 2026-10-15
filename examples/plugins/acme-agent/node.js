// One file, no imports: an installed plugin folder has no node_modules. The host strips
// `/v1/p/acme-agent` from every request, so `/v1/p/acme-agent/summary` arrives as `/summary`.

// Notes per task, in memory, so a restart empties them. A real plugin keeps them with `ctx.storage`.
/** @type {Map<string, { id: string, text: string, at: number }[]>} */
const notes = new Map()
const notesOf = (/** @type {string} */ taskId) => notes.get(taskId) ?? []

/** @param {string} taskId @param {string} text @param {string} id */
function addNote(taskId, text, id) {
  // A lost reply isn't permission to write twice, so a retry with the same id saves nothing new.
  if (notesOf(taskId).some((note) => note.id === id)) return
  notes.set(taskId, [...notesOf(taskId), { id, text, at: Date.now() }])
}

const refuse = (status, message) => Response.json({ error: { code: 'refused', message } }, { status })

export default {
  name: 'acme-agent',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    ctx.routes.fetch(async (request, context) => {
      const path = new URL(request.url).pathname
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
      // An agent's call carries a credential bound to one task. Read the task from it, not the body.
      const taskId = context.principal.taskId
      switch (`${request.method} ${path}`) {
        // #region tools
        // The host posts `{ arguments, origin }` after checking `arguments` against `inputSchema`.
        case 'POST /tools/list-notes':
          if (!taskId) return refuse(403, 'Only an agent working on a task can read its notes.')
          return Response.json({ notes: notesOf(taskId).map(({ text, at }) => ({ text, at })) })
        case 'POST /tools/add-note': {
          if (!taskId) return refuse(403, 'Only an agent working on a task can add a note.')
          // The same id on every retry of one call, so it doubles as an idempotency key.
          const callId = request.headers.get('x-acorn-tool-call-id') ?? crypto.randomUUID()
          addNote(taskId, body.arguments.text, callId)
          return Response.json({ saved: true, count: notesOf(taskId).length })
        }
        // #endregion

        // #region context
        // The host posts `{ origin: { taskId }, scope: 'task' }` when it assembles the task's context.
        case 'POST /context/notes': {
          if (!taskId) return refuse(403, 'Context is read for one task.')
          const list = notesOf(taskId)
          return Response.json({
            items: list.map((note, index) => ({ id: note.id, kind: 'note', label: `Note ${index + 1}`, body: note.text })),
            compact: list.length ? `## Acme notes\n${list.map((note) => `- ${note.text}`).join('\n')}` : '',
            omitted: 0,
          })
        }
        // #endregion

        // #region hooks
        // `agents:before-tool`, as a veto: the body is the call about to run.
        case 'POST /hooks/before-tool': {
          const force = /\bgit\s+push\b.*\s(--force|-f)(\s|$)/.test(body.command ?? '')
          if (!force) return Response.json({ ok: true })
          return Response.json({ ok: false, reason: 'Push with --force-with-lease, so you never overwrite work you haven’t seen.' })
        }
        // `agents:after-tool`, as a transform: only `note` may change, and the model reads it.
        case 'POST /hooks/after-tool': {
          if (body.kind !== 'edit' || !body.succeeded) return Response.json({ payload: body })
          return Response.json({ payload: { ...body, note: 'You changed a file. Run the tests before you finish.' } })
        }
        // #endregion

        // #region generate
        // The task row's menu posts `{ item }`, the task's id.
        case 'POST /summary': {
          // `item` names any task, so an agent's credential, bound to one task, may not call this.
          if (context.principal.scope === 'task') return refuse(403, 'Summaries are run from the task menu.')
          const list = notesOf(body.item)
          if (!list.length) return refuse(400, 'This task has no Acme notes to summarize.')
          try {
            // No `backendId`, so this spends the model the person picked for this plugin in Settings.
            const { text } = await ctx.core.models.generateText({
              userId: ctx.core.identity.active() ?? '',
              input: {
                system: 'Summarize these notes in two sentences for the person who owns the task.',
                prompt: list.map((note) => `- ${note.text}`).join('\n'),
                maxOutputTokens: 300,
              },
            })
            addNote(body.item, `Summary: ${text}`, `summary-${list.length}`)
            ctx.events.notice({ taskId: body.item, title: 'Acme notes summarized', detail: text })
            return Response.json({ ok: true })
          } catch (error) {
            return refuse(409, explain(error))
          }
        }
        // #endregion
        default:
          return new Response('not found', { status: 404 })
      }
    })
  },
}

// #region errors
/** A sentence the person can act on, for the two refusals that spend nothing. */
function explain(error) {
  const code = /** @type {{ code?: string }} */ (error).code
  if (code === 'provider_not_configured') return 'Pick a model for Acme agent kit in Settings › Plugins first.'
  if (code === 'provider_budget_exhausted') return 'Acme agent kit has used today’s allowance. Raise it in Settings › Plugins.'
  return 'The model didn’t answer. Try again in a minute.'
}
// #endregion
