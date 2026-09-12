let mutations = 0
let lost = 0

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
})

const body = async (request) => await request.json().catch(() => ({}))

export default {
  name: 'runtime-fixture',
  init(ctx) {
    ctx.routes.fetch(async (request, routeContext) => {
      const path = new URL(request.url).pathname
      if (path === '/tools/echo') {
        const value = await body(request)
        return json({
          arguments: value.arguments,
          origin: value.origin,
          principal: {
            kind: routeContext.principal.kind,
            scope: routeContext.principal.scope,
            taskId: routeContext.principal.taskId,
            sessionId: routeContext.principal.sessionId,
          },
        })
      }
      if (path === '/tools/mutate') return json({ mutations: ++mutations })
      if (path === '/tools/lost') {
        lost++
        throw new Error('reply was lost after mutation')
      }
      if (path === '/tools/slow') {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 250)
          request.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(request.signal.reason)
          }, { once: true })
        })
        return json({ late: true })
      }
      if (path === '/tools/large') return json({ value: 'x'.repeat(4096) })
      if (path === '/context') {
        const value = await body(request)
        return json({
          items: [{
            id: 'reference-1', kind: 'fixture', label: 'Independent reference', body: 'bounded body',
            sources: [{ label: 'fixture source', uri: 'urn:fixture:reference-1' }],
          }],
          compact: `## Independent fixture\nTask: ${value.origin?.taskId}\n${'bounded '.repeat(400)}`,
          omitted: 7,
        })
      }
      if (path === '/context/fail') throw new Error('section source unavailable')
      if (path === '/context/invalid') return json({ compact: 42 })
      if (path === '/state') return json({ mutations, lost })
      return json({ error: { code: 'not_found', message: 'not found' } }, 404)
    })
  },
}
