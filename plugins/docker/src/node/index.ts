import type { NodePlugin } from '@acorn/plugin-api/node'
import { dockerArchiveConcern } from '../main/archiveCheck'
import { dockerBridge } from '../main/dockerBridge'
import { disposeDocker } from '../main/dockerService'
import { registerDockerWsChannel } from '../main/wsChannel'
import { docker, DOCKER } from '../server/routes/docker'

export const dockerPlugin = (): NodePlugin => {
  let capability: { dispose(): void } | null = null
  return {
  name: 'docker',
  init: (ctx) => {
    const bridge = dockerBridge(ctx.core, ctx.events.send)
    capability = ctx.capabilities.provide(DOCKER, bridge)
    // Archiving a task leaves its containers running unless somebody stops them, so docker says so and
    // offers. Through ctx, like every other contribution here: the host owns the disposal, which is
    // exactly what the client-side version of this check did not have.
    ctx.taskChecks.register({
      id: 'containers',
      check: (task) => dockerArchiveConcern(bridge, task),
      // `compose down` reconstructs the project from labels, so it works whether or not the worktree
      // is still there — but the archive runs this before removal anyway, which is the one ordering
      // the fire-and-forget client version could not promise.
      apply: async (task) => void await bridge.taskTeardown(task.id),
    })
    ctx.routes.register(docker, { prefix: '', note: 'local docker daemon' })
    // The log/stats streams and interactive `docker exec` PTYs ride the one authenticated WebSocket
    // (@acorn/protocol/ws.ts), so the channel handler is part of this plugin's surface too — losing
    // it would leave the routes working and every live pane silent.
    registerDockerWsChannel(ctx.events)
  },
  // Kills the log/stats children and the cached daemon polls this plugin started. The channel handler
  // no longer needs dropping here: it was registered through ctx.events, so the host takes it back on
  // re-init — which is the same guarantee this dispose used to provide by hand, moved somewhere a new
  // plugin cannot forget it.
  dispose: () => {
      capability?.dispose()
    disposeDocker()
  },
  }
}
