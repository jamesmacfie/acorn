// Every route the manifest names. The host strips `/v1/p/acme-data`, so `/v1/p/acme-data/source`
// arrives as `/source`.
import { API } from './cloud.js'

// #region lazy
// Only a dashboard or a workflow reads the data source, so its module loads on the first request
// instead of when the Node starts. A failed load is dropped, so the next request tries again.
/** @type {Promise<typeof import('./source.js')> | undefined} */
let source
const loadSource = () => (source ??= import('./source.js').catch((error) => ((source = undefined), Promise.reject(error))))
// #endregion

/**
 * @param {import('acorn-plugin-types').NodePluginContext} ctx
 * @param {ReturnType<import('./store.js').createStore>} store
 * @param {(taskId: string) => void} changed
 * @returns {import('acorn-plugin-types').PluginFetchHandler}
 */
export function createRoutes(ctx, store, changed) {
  return async (request, context) => {
    const url = new URL(request.url)
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
    switch (`${request.method} ${url.pathname}`) {
      // #region source
      // Every operation on the data source posts here, named by `operation`.
      case 'POST /source': {
        const { description, queryPage } = await loadSource()
        if (body.operation === 'describe') return Response.json(description)
        if (body.operation === 'query') return Response.json(queryPage(store, body))
        return new Response('unsupported operation', { status: 400 })
      }
      // #endregion

      // #region schedule
      // The schedule's run route. The Node posts `{ scheduleId }` as its own service, with no client open.
      case 'POST /schedules/sync': {
        const span = ctx.telemetry.startSpan('sync-deploys')
        try {
          // One call per Acme Cloud connection. The key exists only inside the callback.
          const answers = await context.providers.withConnections('acme-cloud', async (_connection, key) => {
            const response = await fetch(`${API}/v1/deploys`, { headers: { authorization: `Bearer ${key}` } })
            if (!response.ok) throw new Error(`Acme Cloud answered ${response.status}`)
            return /** @type {{ deploys: import('./store.js').Deploy[] }} */ (await response.json()).deploys
          })
          const deploys = answers.flat()
          for (const deploy of deploys) store.add(deploy)
          new Set(deploys.map((deploy) => deploy.taskId)).forEach(changed)
          ctx.telemetry.count('deploys-synced', deploys.length)
          ctx.log.info('synced deploys', { count: deploys.length })
          // #region audit
          // Work done with nobody watching goes on the Node's audit log, under a verb the manifest declares.
          if (deploys.length) ctx.audit.record('sync', { subject: 'acme-cloud', details: { deploys: deploys.length } })
          // #endregion
          span.end('ok')
          return Response.json({ synced: deploys.length })
        } catch (error) {
          span.end('error')
          ctx.log.warn('sync failed', { reason: String(error) })
          // A non-2xx is a failed run: the Node backs off and shows the error on the schedule.
          return new Response('Acme Cloud is unavailable', { status: 502 })
        }
      }
      // #endregion

      // #region check
      // Before a task is archived. Answer fast: the dialog waits two seconds at most.
      case 'GET /archive/check': {
        const running = store.forTask(url.searchParams.get('taskId') ?? '').filter((deploy) => deploy.status === 'running')
        if (!running.length) return Response.json({ concern: null })
        return Response.json({
          concern: {
            id: 'running',
            severity: 'warn',
            message: `${running.length} Acme deploy${running.length === 1 ? ' is' : 's are'} still running for this task`,
            details: running.slice(0, 5).map((deploy) => `${deploy.environment} ${deploy.sha.slice(0, 7)}`),
            ...(running.length > 5 ? { detailsMore: running.length - 5 } : {}),
            action: { label: 'Mark them cancelled', checked: false },
          },
        })
      }
      // Runs only when the person left the box ticked, after the teardown script, before the worktree goes.
      case 'POST /archive/apply': {
        if (typeof body.taskId !== 'string') return new Response('bad request', { status: 400 })
        store.setStatus(body.taskId, 'running', 'cancelled')
        changed(body.taskId)
        return Response.json({ ok: true })
      }
      // #endregion

      // #region cli
      // `acorn plugin acme-data deploys`. The Node checked the device, the Node id, and the task first.
      case 'POST /cli/deploys':
        return Response.json({
          deploys: store.forTask(body.taskId).map(({ environment, status, sha, at }) => ({ environment, status, sha, at })),
        })
      // #endregion
      default:
        return new Response('not found', { status: 404 })
    }
  }
}
