import { handle } from '../server/routes.js'

// Development reload starts a fresh worker and re-evaluates imported modules too.
export default {
  // Must equal the manifest id. The host binds every namespace from the manifest, so a mismatch is a
  // package that disagrees with itself and the load fails.
  name: 'hello-pane',

  /**
   * Typed `ctx` with no build step: `npm i -D acorn-plugin-types` and your editor reads this
   * annotation. The package is declarations only, so nothing is added to what you ship.
   *
   * @param {import('acorn-plugin-types').NodePluginContext} ctx
   */
  init(ctx) {
    // A stderr line with your plugin id on it, and a telemetry log record when the owner has
    // collection on. Prefer it to `console`: the id is bound by the host, the message is scrubbed,
    // and a sink can see it. `ctx.telemetry` beside it carries events, counts, gauges and spans.
    ctx.log.info('starting')

    // The portable carrier. A Hono instance cannot cross a process boundary; a
    // (Request, PluginRequestContext) => Response function can. The host strips the mount, so
    // /v1/p/hello-pane/greeting arrives here as /greeting.
    ctx.routes.fetch((request, context) => handle(request, context, ctx.core))
  },

  // Optional. `ready` runs after every plugin's init; `dispose` runs on unload.
  // ready(ctx) {},
  // dispose() {},
}
