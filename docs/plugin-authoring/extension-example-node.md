# The extension example's Node half

This page is the Node half of [the extension example](./extension-example.md): one file with no
imports that answers every route the manifest names. It's part of
[plugin authoring](../plugin-authoring.md).

## `node.js`

```js
// One file, no imports: an installed plugin folder has no node_modules. The host strips
// `/v1/p/acme-review` from every request, so `/v1/p/acme-review/add` arrives as `/add`.

// Files under review, per task. Memory only, so a restart empties it; a real plugin uses ctx.storage.
/** @type {Map<string, Set<string>>} */
const reviewed = new Map()
const filesOf = (/** @type {string} */ taskId) => reviewed.get(taskId) ?? new Set()

// Fixed answers keep the example free of network calls and accounts.
const DOCS = new Map([['/guide/review', { title: 'Review guide', summary: 'How Acme reviews a change.' }]])
const ISSUES = new Map([['ENG-1', 'Approved by Acme review']])

/**
 * One-based line and column of a UTF-16 offset, the coordinates the host sends and expects.
 * @param {string} text
 * @param {number} offset
 */
function positionAt(text, offset) {
  const lines = text.slice(0, offset).split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

/** @param {string} text */
function todos(text) {
  return [...text.matchAll(/TODO/g)].map((match) => ({
    start: positionAt(text, match.index), end: positionAt(text, match.index + 4),
  }))
}

export default {
  name: 'acme-review',
  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    ctx.routes.fetch(async (request) => {
      const url = new URL(request.url)
      const query = url.searchParams
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
      switch (`${request.method} ${url.pathname}`) {
        case 'POST /add': {
          // The file.row menu row. The body names the file and carries no bytes.
          const { taskId, path } = body.resource ?? {}
          if (typeof taskId !== 'string' || typeof path !== 'string') return new Response('bad request', { status: 400 })
          reviewed.set(taskId, filesOf(taskId).add(path))
          // Editor asks for marks again, and the pane reads the list again.
          ctx.events.send({ channel: 'plugin:acme-review:changed' })
          return Response.json({ ok: true })
        }
        case 'GET /files':
          return Response.json({ files: [...filesOf(query.get('taskId') ?? '')] })
        case 'POST /tools/files':
          // The agent tool. The tool card draws this answer from the call's output.
          return Response.json({ files: [...filesOf(body.origin?.taskId ?? '')] })
        case 'POST /marks': {
          // One batch for every file Editor draws.
          /** @type {{ taskId: string, path: string }[]} */
          const keys = Array.isArray(body.keys) ? body.keys : []
          const items = keys.filter((key) => filesOf(key.taskId).has(key.path))
            .map((key) => ({ key, severity: 'warn', text: 'Under review', icon: 'eye' }))
          return Response.json({ items })
        }
        case 'GET /artifact': {
          // Agents checks that the artifact belongs to the session and the session to the task.
          const media = ctx.capabilities.get('agents.transcriptMedia')
          const read = await media?.read({
            taskId: query.get('taskId') ?? '', sessionId: query.get('sessionId') ?? '',
            kind: 'artifact', id: query.get('id') ?? '',
          })
          if (!read?.bytes) return new Response('not found', { status: 404 })
          return new Response(read.bytes, { headers: { 'content-type': 'text/csv' } })
        }
        case 'GET /docs': {
          const target = URL.parse(query.get('url') ?? '')
          const page = target?.host === 'docs.example.com' ? DOCS.get(target.pathname) : undefined
          return page ? Response.json(page) : new Response('not found', { status: 404 })
        }
        case 'GET /issue':
          return Response.json({ status: ISSUES.get(query.get('item') ?? '') ?? 'No review yet' })
        case 'POST /hover': {
          const hit = todos(body.text).find(({ start, end }) =>
            start.line === body.position.line && start.column <= body.position.column && body.position.column <= end.column)
          if (!hit) return Response.json(null)
          return Response.json({ revision: body.revision, range: hit, contents: { kind: 'markdown', value: 'Resolve before **merge**.' } })
        }
        case 'POST /diagnostics':
          return Response.json({
            revision: body.revision,
            items: todos(body.text).map((range) => ({ range, severity: 'warning', message: 'Unresolved TODO', source: 'acme' })),
          })
        default:
          return new Response('not found', { status: 404 })
      }
    })
  },
}
```

## What each route does

- **`/add`** is the `file.row` menu row's `runNodeAction`. The body is `{ resource: { kind: "file",
  taskId, projectId, path, directory, readOnly, revision? } }`, so the route learns which file and
  never its bytes. Sending on `plugin:acme-review:changed` makes Editor ask for marks again and the
  pane read the list again ([context menus](../plugins/menus-and-markers.md#context-menus)).
- **`/tools/files`** is the agent tool's handler. The host posts `{ arguments, origin }` and checks
  the caller's task before it calls you ([loaded tools](../agent-tools/loaded-tools.md#tool-handlers)).
- **`/marks`** answers one batch for every file Editor draws: the open tabs and the files in expanded
  folders. Return marks only for keys you know. The host keeps 256 and cuts text at 200 characters
  ([file annotations](../editor/file-annotations.md)).
- **`/artifact`** reads bytes through `agents.transcriptMedia`. Agents answers `null` unless the
  artifact belongs to the session and the session to the task, and `bytes` is `null` over 12 MiB
  ([transcript media viewers](../managed-agents/attachments.md#transcript-media-viewers)).
- **`/docs`** checks the host itself. Core fetches nothing for a preview, so your route owns the
  allowed hosts, redirects, size, and timeout ([link previews](../plugins/link-previews.md)).
- **`/issue`** answers for the item Linear's detail view shows. The region's props name the view and
  the item, never Linear's data ([detail regions](../plugins/detail-regions.md)).
- **`/hover`** and **`/diagnostics`** get the live buffer as `{ text, revision }`, and hover adds a
  one-based `position`. Echo `revision`, or the host drops the answer. A hover answers `null` where it
  has nothing to say ([hover and diagnostics](../editor/document-surface.md#hover-and-diagnostics)).

Every route is under `/v1/p/acme-review/`. The host refuses a manifest that names a route in another
plugin's namespace, and another plugin's tree can't call yours.
