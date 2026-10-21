import { createRoutes } from '../server/routes.js'
import { createStore } from '../server/store.js'
import { acmeCloud } from '../server/cloud.js'
import { recordDeployStep } from '../server/step.js'

export default {
  // Must equal the manifest id.
  name: 'acme-data',

  /** @param {import('acorn-plugin-types').NodePluginContext} ctx */
  init(ctx) {
    // #region open
    // The host opens <data root>/plugins/acme-data.sqlite and applies ./migrations before it returns.
    const store = createStore(ctx.storage.open())
    // #endregion

    // #region publish
    // After a write: tell other plugins with the verb the manifest declares under `emits`, tell
    // clients to read this plugin's badges and marks again, and tell acorn the deploys source changed,
    // so a trigger on it checks now rather than on its cadence.
    const changed = (/** @type {string} */ taskId) => {
      ctx.events.send({ channel: 'plugin:acme-data:deploys-changed', taskId })
      ctx.events.status()
      ctx.dataSources.changed('deploys')
    }
    // #endregion

    ctx.routes.fetch(createRoutes(ctx, store, changed))

    // #region provide
    // Another plugin calls this with `ctx.capabilities.get('acme-data.deploys')`.
    ctx.capabilities.provide('acme-data.deploys', {
      /** @param {string} taskId */
      latest: (taskId) => store.forTask(taskId)[0] ?? null,
    })
    // #endregion

    // #region subscribe
    // A core event. Every commit on a task's branch gets a pending staging deploy. The frame carries
    // the new HEAD, so there's nothing to read back.
    ctx.events.on('head:changed', (frame) => {
      if (typeof frame.taskId !== 'string' || typeof frame.head !== 'string') return
      store.add({ id: `d-${frame.head}-staging`, taskId: frame.taskId, environment: 'staging', status: 'pending', sha: frame.head, at: Date.now() })
      changed(frame.taskId)
    })
    // #endregion

    // #region connect
    ctx.providers.connection(acmeCloud)
    // #endregion

    // #region step-kind
    // Workflows opens this point. Saved workflows name the step `acme-data:record-deploy`.
    ctx.extensionPoints.handle('workflows:step-kind', { id: 'record-deploy', value: recordDeployStep(store, changed) })
    // #endregion
  },
}
