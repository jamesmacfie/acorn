import { createTracker } from '../server/routes.js'

export default {
  // Must equal the manifest id.
  name: 'acme-tracker',

  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    // #region consume
    // acme-data's deploys, when it's installed. `get` answers undefined when it isn't, and the task
    // marks leave the deploy out. Resolve it on each call, never once at init.
    const deployOf = (/** @type {string} */ taskId) => ctx.capabilities.get('acme-data.deploys')?.latest(taskId) ?? null
    // A deploy changed, so every client reads this plugin's marks again. Events have no replay, so
    // nothing is kept from the frame: the marks read the capability each time they're asked.
    ctx.events.on('plugin:acme-data:deploys-changed', () => ctx.events.status())
    // #endregion

    // The host strips `/v1/p/acme-tracker`, so `/v1/p/acme-tracker/issues` arrives as `/issues`.
    ctx.routes.fetch(createTracker(ctx.events, deployOf))
  },
}
