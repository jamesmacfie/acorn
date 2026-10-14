// A loaded plugin's node half that serves one browser handoff and its tasks' app addresses, written
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
  },
}
