import { Hono } from 'hono'
import {
  nodeAdoptBodySchema,
  nodeCreateRequestSchema,
  nodeLifecycleRequestSchema,
  type NodeAdoptResult,
  type NodeProvidersResponse,
  type ProvidedNode,
} from '@acorn/protocol/nodeProviders.ts'
import { nodeProvider, nodeProviderDescriptor, nodeProviders, type ProvidedNodeRecord } from '../nodeProviders/registry'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// The nodes this node's plugins know about, and the four lifecycle verbs
// (docs/plugins.md § Node providers).
//
// Gated with requireDevice by mount in server/index.ts. Every route here either enumerates
// infrastructure, hands over a credential, or spends money, and none of it is a fair question for a
// task-scoped agent.
//
// The client reads this by fanning out over every reachable node and unioning the answers, deduped on
// providerId plus providerNodeId. So the route answers for this node only and never tries to be the
// fleet's view of itself: whichever node holds the cloud connection is the one whose providers reply,
// and today that is usually the local one, which is exactly the assumption the fan-out avoids baking
// in (docs/future/phased-review-steps/cloud-guardrails.md rule 3).

// Long enough for a cloud API round trip, short enough that one wedged provider does not hold the
// response open past the client's own per-node deadline (5s in client-core/infra/node/fanout.ts).
const LIST_TIMEOUT_MS = 4_000
// Provisioning is slower than listing, and by a lot. Still bounded: a caller that never gets an answer
// cannot tell a slow create from a failed one.
const MUTATE_TIMEOUT_MS = 60_000

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The wire projection: everything the provider said except the credential. Written as an explicit
// field list rather than a delete, so a provider that grows a field has to be given one here before it
// can reach a client.
const publicNode = (record: ProvidedNodeRecord, providerId: string): ProvidedNode & { providerId: string } => ({
  providerId,
  providerNodeId: record.providerNodeId,
  nodeId: record.nodeId,
  label: record.label,
  endpoint: record.endpoint,
  fingerprint: record.fingerprint,
  state: record.state,
})

const withTimeout = async <T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`no answer within ${Math.round(ms / 1000)}s`)), ms)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

export const nodeProviderRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const registered = nodeProviders()
    const nodes: NodeProvidersResponse['nodes'] = []
    const failures: NodeProvidersResponse['failures'] = []
    // Sequential rather than Promise.all: providers are few, each is a network call the owner is
    // paying for, and a partial answer is the contract anyway.
    for (const provider of registered) {
      try {
        const listed = await withTimeout(LIST_TIMEOUT_MS, (signal) => provider.list(signal))
        for (const record of listed) nodes.push(publicNode(record, provider.qualifiedId))
      } catch (error) {
        // One provider being unreachable is a line, never a failed response: the same partial-result
        // posture the client's fan-out takes across nodes.
        failures.push({ providerId: provider.qualifiedId, reason: reasonOf(error) })
      }
    }
    return c.json({ providers: registered.map(nodeProviderDescriptor), nodes, failures } satisfies NodeProvidersResponse)
  })
  // The credential half of adoption, answered to the desktop host and nobody else in practice: the
  // renderer names a provider and a node, and the reply goes to whoever is holding the device-token
  // store. See @acorn/protocol/broker.ts for why the host still probes the endpoint afterwards rather
  // than trusting the fingerprint below.
  .post('/adopt', async (c) => {
    const body = nodeAdoptBodySchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return respondError(c, 400, 'bad_request', ['Name a providerId and a providerNodeId.'])
    const provider = nodeProvider(body.data.providerId)
    if (!provider) return respondError(c, 404, 'not_found', [`No node provider '${body.data.providerId}' on this node.`])
    let listed: ProvidedNodeRecord[]
    try {
      listed = await withTimeout(LIST_TIMEOUT_MS, (signal) => provider.list(signal))
    } catch (error) {
      return respondError(c, 502, 'upstream', [`${provider.label} could not list its nodes: ${reasonOf(error)}`])
    }
    // Re-listed rather than taken from the request: the caller names a node, and the provider is what
    // says where it is and how to authenticate to it. A caller cannot smuggle in an endpoint.
    const record = listed.find((candidate) => candidate.providerNodeId === body.data.providerNodeId)
    if (!record) return respondError(c, 404, 'not_found', [`${provider.label} does not list '${body.data.providerNodeId}'.`])
    if (!record.nodeId || !record.endpoint || !record.fingerprint) {
      return respondError(c, 409, 'conflict', [`${record.label} is ${record.state} and has nothing to connect to yet.`])
    }
    if (!record.enrollment?.deviceToken) {
      return respondError(c, 409, 'conflict', [`${provider.label} holds no credential for ${record.label}, so it cannot be adopted.`])
    }
    return c.json({
      nodeId: record.nodeId,
      label: record.label,
      endpoint: record.endpoint,
      fingerprint: record.fingerprint,
      deviceToken: record.enrollment.deviceToken,
    } satisfies NodeAdoptResult)
  })
  .post('/create', async (c) => {
    const body = nodeCreateRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return respondError(c, 400, 'bad_request', ['Name a providerId and a label.'])
    const provider = nodeProvider(body.data.providerId)
    if (!provider?.create) return respondError(c, 404, 'not_found', [`No node provider '${body.data.providerId}' that can create nodes.`])
    const create = provider.create.bind(provider)
    try {
      const record = await withTimeout(MUTATE_TIMEOUT_MS, (signal) =>
        create({ label: body.data.label, options: body.data.options }, signal),
      )
      return c.json(publicNode(record, provider.qualifiedId))
    } catch (error) {
      return respondError(c, 502, 'upstream', [`${provider.label} could not create a node: ${reasonOf(error)}`])
    }
  })
  // One handler for the three verbs that name an existing node. They differ only in which method they
  // call and how loudly the client warns first, and the tier is the client's to draw from
  // NODE_LIFECYCLE_RISK — nothing here confirms anything, because a confirmation the node performs is
  // one the owner never saw.
  .post('/:verb{destroy|start|stop}', async (c) => {
    const verb = c.req.param('verb') as 'destroy' | 'start' | 'stop'
    const body = nodeLifecycleRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return respondError(c, 400, 'bad_request', ['Name a providerId and a providerNodeId.'])
    const provider = nodeProvider(body.data.providerId)
    const run = provider?.[verb]?.bind(provider)
    if (!run) return respondError(c, 404, 'not_found', [`No node provider '${body.data.providerId}' that can ${verb} nodes.`])
    try {
      await withTimeout(MUTATE_TIMEOUT_MS, (signal) => run(body.data.providerNodeId, signal))
      return c.body(null, 204)
    } catch (error) {
      return respondError(c, 502, 'upstream', [`${provider!.label} could not ${verb} that node: ${reasonOf(error)}`])
    }
  })
