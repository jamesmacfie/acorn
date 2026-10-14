// A loaded plugin's node half that serves one browser handoff, its tasks' app addresses, and a sidebar
// panel for one task, written
// against the public contract alone: no browser code and no core import. browserHandoffs.test.ts runs
// it in its real worker.
export default {
  name: 'tracker',
  init(ctx) {
    ctx.routes.fetch(
      async (request) => {
        const { url, captures } = await request.json()
        const connection = { id: 'conn-1', label: 'Tracker' }
        return Response.json({
          items: [
            {
              identifier: `TRK-${captures.id}`,
              url,
              title: `Tracker item ${captures.id}`,
              connection,
              projects: ['project-1'],
              seed: {
                origin: 'tracker',
                title: `Tracker item ${captures.id}`,
                links: [{ connectionId: connection.id, identifier: `TRK-${captures.id}` }],
              },
              context: { label: `Tracker item TRK-${captures.id}`, content: 'What the agent should read.' },
            },
          ],
        })
      },
      { prefix: '/handoff' },
    )
    ctx.routes.fetch(
      async () =>
        Response.json({
          addresses: [
            {
              taskId: 'task-1',
              origin: 'https://tracker-app.localhost:5104',
              label: 'Tracker app',
              state: 'running',
              severity: 'info',
            },
          ],
        }),
      { prefix: '/task-addresses' },
    )
    // task-1 has a panel; every other task answers 404, so the extension shows no nav item for it.
    ctx.routes.fetch(
      async (request) => {
        const query = new URL(request.url).searchParams
        if (query.get('taskId') !== 'task-1') return new Response(null, { status: 404 })
        const source = query.get('source') ?? 'web'
        return Response.json({
          blocks: [
            { kind: 'status', label: 'Tracker app', state: 'running', severity: 'info' },
            { kind: 'links', title: 'Links', links: [{ label: 'App', url: 'https://tracker-app.localhost:5104' }] },
            { kind: 'rows', title: 'Services', rows: [{ label: 'web', state: 'healthy', severity: 'info' }] },
            {
              kind: 'logs',
              title: 'Logs',
              sources: [
                { id: 'web', label: 'web' },
                { id: 'worker', label: 'worker' },
              ],
              source,
              lines: [`${source} ready`],
            },
          ],
        })
      },
      { prefix: '/browser-panel' },
    )
  },
}
