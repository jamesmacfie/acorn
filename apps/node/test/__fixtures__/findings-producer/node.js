let findings = null

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
})

export default {
  name: 'architecture-review',
  init(ctx) {
    ctx.extensionPoints.handle('findings:kind', {
      id: 'architecture',
      value: { version: 1, label: 'Architecture concern' },
    })
    ctx.extensionPoints.handle('findings:producer', {
      id: 'review',
      value: {
        kinds: ['architecture'],
        connect(writer) {
          findings = writer
          return () => { findings = null }
        },
      },
    })
    ctx.routes.fetch(async (request) => {
      if (new URL(request.url).pathname !== '/record' || request.method !== 'POST') {
        return json({ error: { code: 'not_found', message: 'not found' } }, 404)
      }
      if (!findings) return json({ error: { code: 'unavailable', message: 'findings is unavailable' } }, 503)
      const input = await request.json()
      const result = await findings.record({ kind: 'task', taskId: input.taskId }, {
        sourceKey: input.sourceKey,
        kind: 'architecture-review:architecture',
        kindVersion: 1,
        title: input.title,
        body: input.body,
        claimStatus: 'observed',
        evidence: [],
      })
      return json(result, result.created ? 201 : 200)
    })
  },
}
