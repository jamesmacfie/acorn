import { Hono, type Context } from 'hono'
import { nodeReachRequestSchema, type NodeReach } from '@acorn/protocol/api.ts'
import { auditRequest } from '../auditRequest'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import { readNodeReach, recordNodeReach } from '../storage/dataRoot'
import { advertisedByEnvironment, advertisedHosts, lanCandidates } from '../transport/advertise'
import { isLoopbackPeer } from '../transport/loopbackPeer'

// Which addresses this Node answers on besides loopback, for Settings → Nodes and `acorn node reach`
// (docs/node-distribution/reaching.md).
//
// Gated with requireDevice by mount in server/index.ts. The write is also only from this computer,
// like stopping: a client elsewhere that narrows the list can lock itself out, and one that widens it
// changes the machine's exposure from somewhere else. Nothing here restarts the Node. The listener
// binds once at boot, so the caller restarts it.

function reachOf(c: Context<AppEnv>): NodeReach {
  const recorded = readNodeReach(c.env.DATA_DIR)
  const hosts = advertisedHosts(recorded)
  return {
    hosts,
    source: advertisedByEnvironment() ? 'environment' : hosts.length > 0 ? 'node.json' : 'none',
    // Recorded when the listener bound, so it's the port this request arrived on.
    port: recorded.port ?? 0,
    candidates: lanCandidates(),
    restartRequired: hosts.join(',') !== c.env.ADVERTISED_HOSTS.join(','),
  }
}

export const nodeReach = new Hono<AppEnv>()
  .get('/reach', (c) => c.json(reachOf(c)))
  .put('/reach', async (c) => {
    if (!isLoopbackPeer(c.env.incoming?.socket.remoteAddress))
      return respondError(c, 403, 'reach_local_only', ['Change who can reach a Node from its own computer.'])
    if (advertisedByEnvironment())
      return respondError(c, 409, 'reach_set_by_environment', [
        'ACORN_ADVERTISE_HOST sets these hosts, so a change here would do nothing. Change the variable and restart the Node.',
      ])
    const parsed = nodeReachRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return respondError(
        c,
        400,
        'bad_request',
        parsed.error.issues.map((issue) => issue.message),
      )
    const from = advertisedHosts(readNodeReach(c.env.DATA_DIR)).join(',')
    const to = parsed.data.hosts.join(',')
    recordNodeReach(c.env.DATA_DIR, to)
    auditRequest(c, { action: 'node.reach.changed', details: { from, to } })
    return c.json(reachOf(c))
  })
