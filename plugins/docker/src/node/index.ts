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
    registerDockerWsChannel(ctx.events)
  },
  // Kills the log/stats children and the cached daemon polls this plugin started. The channel handler
  // no longer needs dropping here: it was registered through ctx.events, so the host takes it back on
  // re-init — which is the same guarantee this dispose used to provide by hand, moved somewhere a new
  // plugin cannot forget it.
  dispose: () => {
    setDockerBridge(null)
    disposeDocker()
  },
})
