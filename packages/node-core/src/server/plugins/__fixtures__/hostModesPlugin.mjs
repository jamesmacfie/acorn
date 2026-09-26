export default {
  name: 'host-modes',
  async init(ctx) {
    if ('tools' in ctx || 'contextSections' in ctx || 'nodeActions' in ctx || 'harnesses' in ctx
      || 'register' in ctx.routes || 'registerTarget' in ctx.schedules
      || 'channel' in ctx.events || 'streams' in ctx.events) {
      throw new Error('compiled-only authority reached the loaded worker')
    }
    const immediate = (value, label) => {
      if (value instanceof Promise) throw new Error(`${label} crossed as a Promise`)
    }
    immediate(ctx.routes.fetch(() => new Response('ok')), 'routes.fetch')
    immediate(ctx.schedules.register({ scheduleId: 'probe', name: 'Probe', cadence: { every: 300 }, run: async () => {} }), 'schedules.register')
    immediate(ctx.dataSources.register({ id: 'probe' }), 'dataSources.register')
    immediate(ctx.taskChecks.register({ id: 'probe' }), 'taskChecks.register')
    immediate(ctx.runs.register({ id: 'probe' }), 'runs.register')
    immediate(ctx.audit.declare({ id: 'probe', label: 'Probe' }), 'audit.declare')
    immediate(ctx.extensionPoints.declare('probe:point', 'Probe'), 'extensionPoints.declare')
    immediate(ctx.hooks.declare({ id: 'probe' }), 'hooks.declare')
    immediate(ctx.providers.connection({ id: 'probe' }), 'providers.connection')
    immediate(ctx.providers.integration({ id: 'probe' }, async (_request, context) => {
      const items = context.providers.items('probe')
      return Response.json(await items.listByIdentifier(['ENG-42']))
    }), 'providers.integration')
    immediate(ctx.providers.model({
      providerId: 'probe', recommendedModelId: 'probe-model',
      generateText: async ({ secret, input }) => ({ text: `${secret}:${input.prompt}`, modelId: 'probe-model' }),
    }), 'providers.model')
    const owned = ctx.capabilities.provide('probe', { read: async () => 'capability' })
    immediate(owned, 'capabilities.provide')
    const capability = ctx.capabilities.get('probe')
    immediate(capability, 'capabilities.get')
    if (await capability.read() !== 'capability') throw new Error('dynamic capability callback changed mode')
    const subscription = ctx.events.on('tasks:changed', () => 'heard')
    immediate(subscription, 'events.on')
    immediate(subscription.dispose(), 'events.on.dispose')
    immediate(ctx.events.status(), 'events.status')
    immediate(ctx.telemetry.event('probe'), 'telemetry.event')
    immediate(ctx.log.info('probe'), 'log.info')
    immediate(ctx.core.identity.active(), 'core.identity.active')
    immediate(ctx.core.fs.isValidRepoIdent('repo'), 'core.fs.isValidRepoIdent')
    immediate(ctx.core.proc.brokerEnv({}), 'core.proc.brokerEnv')
    const batch = ctx.core.telemetry.onBatch(() => {})
    immediate(batch, 'core.telemetry.onBatch')
    immediate(batch.dispose(), 'core.telemetry.onBatch.dispose')
    const loaded = ctx.core.tasks.load('task')
    if (!(loaded instanceof Promise)) throw new Error('core.tasks.load lost its Promise')
    await loaded
    const measured = ctx.telemetry.measure('probe', () => 42)
    immediate(measured, 'telemetry.measure')
    if (measured !== 42) throw new Error('telemetry.measure lost callback return value')
    try {
      ctx.telemetry.measure('async', async () => 42)
      throw new Error('async measure unexpectedly succeeded')
    } catch (error) {
      if (!String(error).includes('asynchronous plugin callback crossed a synchronous RPC seam')) throw error
    }
    immediate(owned.dispose(), 'capabilities.provide.dispose')
  },
}
