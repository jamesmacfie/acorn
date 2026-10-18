import { Hono } from 'hono'
import { nodeStopRequestSchema } from '@acorn/protocol/node.ts'
import { auditRequest } from '../auditRequest'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import { isLoopbackPeer } from '../transport/loopbackPeer'

// Stop or restart this Node with the same bounded drain as SIGTERM (docs/cli/local-service.md § Stop
// and restart). It exists because Windows has no SIGTERM a Node.js process can catch.
//
// Gated with requireDevice by mount in server/index.ts. Only from this computer, like pairing by
// approval: stopping a Node is decided on its own machine, so a paired client elsewhere can't take it
// down.
export const nodeStop = new Hono<AppEnv>().post('/stop', async (c) => {
  if (!isLoopbackPeer(c.env.incoming?.socket.remoteAddress))
    return respondError(c, 403, 'stop_local_only', ['Stop a Node from its own computer.'])
  if (!c.env.REQUEST_STOP)
    return respondError(c, 409, 'stop_unavailable', ['The desktop app runs this Node. Quit the app to stop it.'])
  // No body is a plain stop.
  const parsed = nodeStopRequestSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return respondError(c, 400, 'bad_request', ['The body may only set restart.'])
  const restart = parsed.data.restart === true
  auditRequest(c, { action: 'node.stop.requested', details: { restart } })
  // Once this response is out: the drain closes every connection at once, and would cut off the 202.
  const stop = () => c.env.REQUEST_STOP?.(restart)
  if (c.env.outgoing) c.env.outgoing.once('close', stop)
  else setImmediate(stop)
  return c.body(null, 202)
})
