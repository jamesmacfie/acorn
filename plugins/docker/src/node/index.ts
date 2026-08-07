import { registerWsChannelHandler } from '@acorn/node-core/main/wsHub.ts'
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { dockerBridge } from '../main/dockerBridge'
import { disposeDocker } from '../main/dockerService'
import { registerDockerWsChannel } from '../main/wsChannel'
import { docker, setDockerBridge } from '../server/routes/docker'

export const dockerPlugin = (): NodePlugin => ({
  name: 'docker',
  init: (ctx) => {
    setDockerBridge(dockerBridge(ctx.core))
    ctx.routes.register(docker, { prefix: '', note: 'local docker daemon' })
    // The log/stats streams and interactive `docker exec` PTYs ride the one authenticated WebSocket
    // (@acorn/protocol/ws.ts), so the channel handler is part of this plugin's surface too — losing
    // it would leave the routes working and every live pane silent.
    registerDockerWsChannel()
  },
  // Kills the log/stats children and the cached daemon polls this plugin started. The channel handler
  // is dropped explicitly rather than relying on disposeWsHub having cleared the whole table first:
  // "release what init opened" has to hold on its own, or a change to teardown order leaves a handler
  // closed over a disposed plugin.
  dispose: () => {
    registerWsChannelHandler('docker', null)
    setDockerBridge(null)
    disposeDocker()
  },
})
