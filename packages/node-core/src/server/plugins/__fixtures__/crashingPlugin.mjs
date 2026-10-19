// A loaded plugin's node half that serves one route, then throws from a timer nothing can catch, the
// way a library's child-process callback can. workerStopped.test.ts runs it in its real worker.
export default {
  name: 'crasher',
  init(ctx) {
    ctx.routes.fetch(() => new Response('alive'))
    setTimeout(() => {
      throw new Error('boom from a timer')
    }, 200)
  },
}
