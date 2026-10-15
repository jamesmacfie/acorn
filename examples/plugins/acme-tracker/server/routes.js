// Every route the manifest names. The issues are fixed data in memory, so the example needs no
// account or network, and a restart puts them back. A real plugin reads its service, and keeps what it
// writes with `ctx.storage`.

/** @typedef {{ id: string, key: string, title: string, state: 'Todo' | 'In progress' | 'In review', summary: string }} Issue */

/** @returns {Issue[]} */
const seed = () => [
  { id: 'i12', key: 'ACME-12', title: 'Webhooks give up after one retry', state: 'In progress',
    summary: 'A failed delivery is retried once, then dropped. Retry with backoff for an hour.' },
  { id: 'i14', key: 'ACME-14', title: 'VAT missing on EU invoices', state: 'In review',
    summary: 'Invoices to EU customers show no VAT line when the customer has no tax ID.' },
  { id: 'i15', key: 'ACME-15', title: 'Overdue invoice query is slow', state: 'Todo',
    summary: 'The overdue report scans every invoice. Add an index on the due date.' },
]

/**
 * @param {import('acorn-plugin-types').NodePluginContext['events']} events
 * @returns {(request: Request) => Promise<Response>}
 */
export function createTracker(events) {
  const issues = seed()
  /** Issue ids linked to each task, by task id. */
  const links = new Map()
  let sort = 'state'
  const open = () => issues.filter((issue) => issue.state !== 'In review')

  return async (request) => {
    const url = new URL(request.url)
    const query = url.searchParams
    const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}))
    switch (`${request.method} ${url.pathname}`) {
      // #region issues
      // What the trees draw: the rail source's list and detail, the pane, and the reference panel.
      case 'GET /issues':
        return Response.json({ items: sorted(issues, sort) })
      // #endregion

      // #region commands
      // A `search` command: the host sends what the person typed as `q`, and draws the rows.
      case 'GET /issues/search': {
        const words = (query.get('q') ?? '').toLowerCase()
        const items = issues
          .filter((issue) => `${issue.key} ${issue.title}`.toLowerCase().includes(words))
          .map((issue) => ({ id: issue.key, title: issue.title, subtitle: issue.key, badge: issue.state }))
        return Response.json({ items })
      }
      // An `input` command: the host posts `{ input, taskId? }` when the person presses Enter.
      case 'POST /issues': {
        const title = typeof body.input === 'string' ? body.input.trim() : ''
        if (!title) return Response.json({ error: { code: 'invalid', message: 'Give the issue a title.' } }, { status: 400 })
        const issue = { id: `i${issues.length + 20}`, key: `ACME-${issues.length + 20}`, title, state: 'Todo', summary: '' }
        issues.push(issue)
        if (typeof body.taskId === 'string') links.set(body.taskId, [...(links.get(body.taskId) ?? []), issue.id])
        // #region notice
        // A row in the person's notification bell. The host fills in where clicking it goes.
        events.notice({ taskId: body.taskId, title: `${issue.key} created`, detail: title })
        // #endregion
        // #region status
        // The count changed, so every client reads this plugin's badges, rows, and marks again.
        events.status()
        // #endregion
        return Response.json({ ok: true, message: `Created ${issue.key}` })
      }
      // A `setting` command and the settings page share these two: both answer `{ value }`.
      case 'GET /sort':
        return Response.json({ value: sort })
      case 'PUT /sort':
        if (body.value !== 'state' && body.value !== 'key') return new Response('bad value', { status: 400 })
        sort = body.value
        return Response.json({ value: sort })
      // #endregion

      // #region badges
      // A top bar badge. Answer `null` to hide it.
      case 'GET /badge/open': {
        const count = open().length
        return Response.json(count ? { text: `${count} open`, tone: 'accent', tooltip: 'Open Acme issues' } : null)
      }
      // The task footer's badge. Badge routes get no task, so it counts across the tracker.
      case 'GET /badge/review': {
        const count = issues.filter((issue) => issue.state === 'In review').length
        return Response.json(count ? { text: `${count} in review`, tone: 'neutral' } : null)
      }
      // #endregion

      // #region marks
      // `core:task`: the host posts every task id on screen, and gets marks for the ones you know.
      case 'POST /marks/tasks':
        return Response.json({
          items: keys(body)
            .filter((key) => links.get(key.task)?.length)
            .map((key) => ({ key, severity: 'info', text: `${links.get(key.task).length} Acme issue(s)`, icon: 'list-todo' })),
        })
      // `core:source`: rail source icons whose owner consented with `statusAnnotations`.
      case 'POST /marks/sources':
        return Response.json({
          items: keys(body)
            .filter((key) => key.sourceId === 'issues')
            .map((key) => ({ key, severity: 'warn', text: `${open().length} open issues` })),
        })
      // `core:pane`: pane switcher buttons whose pane consented with `statusAnnotations`.
      case 'POST /marks/panes':
        return Response.json({
          items: keys(body)
            .filter((key) => key.paneId === 'acme-tracker' && links.get(key.taskId)?.length)
            .map((key) => ({ key, severity: 'info', text: 'Linked to an Acme issue' })),
        })
      // #endregion

      // #region attention
      // The inbox. A `warn` item stays until this route stops answering it.
      case 'GET /attention':
        return Response.json({
          items: issues
            .filter((issue) => issue.state === 'In review')
            .map((issue) => ({ id: issue.id, title: `${issue.key} is waiting for review`, severity: 'warn', at: Date.now() - 60 * 60_000 })),
        })
      // #endregion

      // #region menus
      // A task row's menu: the body is `{ item }`, the task's id.
      case 'POST /link': {
        if (typeof body.item !== 'string') return new Response('bad request', { status: 400 })
        const next = open().find((issue) => !links.get(body.item)?.includes(issue.id))
        if (!next) return Response.json({ ok: true })
        links.set(body.item, [...(links.get(body.item) ?? []), next.id])
        events.status()
        return Response.json({ ok: true, message: `Linked ${next.key}` })
      }
      // An agent message's menu: the body carries the text the card shows.
      case 'POST /file': {
        const text = body.message?.text
        if (typeof text !== 'string') return new Response('bad request', { status: 400 })
        const title = text.split('\n')[0].slice(0, 120)
        issues.push({ id: `i${issues.length + 20}`, key: `ACME-${issues.length + 20}`, title, state: 'Todo', summary: text })
        events.status()
        return Response.json({ ok: true, message: 'Filed as an Acme issue' })
      }
      // The rail icon's menu: the body is `{ rail: { location, sourceId, projectId } }`.
      case 'POST /refresh':
        return Response.json({ ok: true })
      // #endregion
      default:
        return new Response('not found', { status: 404 })
    }
  }
}

/** The keys an annotation request asks about. Anything else in the body is ignored. */
const keys = (body) => (Array.isArray(body.keys) ? body.keys : [])

/** @param {Issue[]} issues @param {string} by */
const sorted = (issues, by) =>
  [...issues].sort((a, b) => (by === 'key' ? a.key.localeCompare(b.key) : a.state.localeCompare(b.state)))
