import { createTracker } from '../server/routes.js'

export default {
  // Must equal the manifest id.
  name: 'acme-tracker',

  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    // The host strips `/v1/p/acme-tracker`, so `/v1/p/acme-tracker/issues` arrives as `/issues`.
    ctx.routes.fetch(createTracker(ctx.events))
  },
}
