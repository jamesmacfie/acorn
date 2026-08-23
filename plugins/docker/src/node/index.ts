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
    // Archiving a task leaves its containers running unless somebody stops them, so docker says so
    // and offers to. Registered through ctx, like every other contribution here, so the host owns the
    // disposal.
    ctx.taskChecks.register({
      id: 'containers',
      check: (task) => dockerArchiveConcern(bridge, task),
      // `compose down` reconstructs the project from labels, so it works whether or not the worktree
      // is still there. The archive runs it before removal.
      apply: async (task) => void await bridge.taskTeardown(task.id),
    })
    ctx.routes.register(docker, { prefix: '', note: 'local docker daemon' })
    // The log and stats streams and the interactive `docker exec` PTYs ride the one authenticated
    // WebSocket (@acorn/protocol/ws.ts), so the channel handler is part of this plugin's surface.
    // Drop it and the routes keep working while every live pane goes silent.
    registerDockerWsChannel(ctx.events)
  },
  // Kills the log and stats children and the cached daemon polls this plugin started. The channel
  // handler needs no dropping here: it registered through ctx.events, so the host takes it back on
  // re-init.
  dispose: () => {
      capability?.dispose()
    disposeDocker()
  },
  }
}
