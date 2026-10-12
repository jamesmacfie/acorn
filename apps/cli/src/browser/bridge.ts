import { randomUUID } from 'node:crypto'
import { NodeBroker, toNodeRecord, type FleetStore } from '@acorn/custody/broker'
import { pairWithNode, probeNode } from '@acorn/custody/broker/nodePairing.ts'
import type { NodeFetchResponse, NodeStatus } from '@acorn/protocol/broker.ts'
import type {
  BridgeAgentHint,
  BridgeErrorCode,
  BridgeNodes,
  BridgeProject,
  BridgeRequest,
  BridgeResults,
} from '@acorn/protocol/extensionBridge.ts'
import { projectsRoute, tasksRoute, type ProjectsResponse, type Task } from '@acorn/protocol/api.ts'
import type {
  AgentProviderDescriptor,
  AgentSession,
  AgentSessionList,
  AgentSessionSnapshot,
  AgentTurn,
} from '@acorn/plugin-agents/contract/wire.ts'
import { agentHints, agentsRoute, bridgeProfile, bridgeSession, bridgeSessionRead, sessionRoute } from './agents'

export class BridgeFailure extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message)
  }
}

type Probe = Awaited<ReturnType<typeof probeNode>>

// The native host's operations, over this browser's own custody. The certificate, the token, and the
// broker stay in this process; replies carry node records, probe results, and project rows only.
//
// One node is connected at a time: the one the extension selected. Every node-bound operation names
// its node, and is refused when that node is no longer the selection, before and after the request.
export function createBridge(options: {
  fleet: FleetStore
  deviceName: string
  status(status: NodeStatus): void
  hint?(hint: BridgeAgentHint): void
  probe?: typeof probeNode
  pair?: typeof pairWithNode
}) {
  const { fleet } = options
  const probe = options.probe ?? probeNode
  const pair = options.pair ?? pairWithNode
  let activeNodeId: string | null = null
  // The selected Node presented a certificate other than its pin. Its connection is closed until the
  // person pairs it again, and its status says why rather than reading as an ordinary outage.
  let identityChanged: string | null = null
  // The probe is held here rather than returned, so pairing can only complete the endpoint whose
  // fingerprint the person was shown.
  let pending: Probe | null = null
  const hints = agentHints(options.hint ?? (() => {}))
  const broker = new NodeBroker({
    frame(nodeId, frame) {
      if (nodeId === activeNodeId) hints.note(nodeId, frame)
    },
    bytes() {},
    status(status) {
      if (status.nodeId === activeNodeId) options.status(status)
    },
  })

  const nodes = (): BridgeNodes => ({
    nodes: fleet.list().map(toNodeRecord),
    activeNodeId,
    status:
      identityChanged && identityChanged === activeNodeId
        ? changedIdentityStatus(identityChanged)
        : (broker.statuses().find((status) => status.nodeId === activeNodeId) ?? null),
  })

  const select = (nodeId: string | null): BridgeNodes => {
    if (nodeId !== null) {
      const node = fleet.get(nodeId)
      if (!node) throw new BridgeFailure('unknown_node', 'This browser has not paired that Node.')
      const token = fleet.tokenFor(nodeId)
      if (!token || !node.certPem)
        throw new BridgeFailure('pairing_required', 'This browser has no credential for that Node. Pair it again.')
      if (activeNodeId !== nodeId) {
        if (activeNodeId) broker.remove(activeNodeId)
        broker.upsert({ ...toNodeRecord(node), token, certPem: node.certPem })
      }
    } else if (activeNodeId) broker.remove(activeNodeId)
    if (activeNodeId !== nodeId) identityChanged = null
    activeNodeId = nodeId
    return nodes()
  }

  const requireSelected = (nodeId: string): void => {
    if (activeNodeId !== nodeId)
      throw new BridgeFailure('not_selected', 'That Node is not the selected Node, so the request was refused.')
  }

  // A regenerated certificate fails the pinned chain check before the fingerprint comparison runs, so
  // the broker reports it as unreachable. Probing says which it was, as `openCliNode` does.
  async function presentsAnotherCertificate(nodeId: string): Promise<boolean> {
    const node = fleet.get(nodeId)
    if (!node?.fingerprint) return false
    try {
      // Both sides come from `probeNode`, which normalizes the fingerprint.
      return (await probe(node.endpoint)).fingerprint !== node.fingerprint
    } catch {
      return false
    }
  }

  // One Node route for the selected node. A read is refused if the selection moved while it was out;
  // a write isn't, because once sent it may have happened, and the caller must hear its outcome.
  async function nodeRequest(
    nodeId: string,
    request: { method: 'GET' | 'POST'; path: string; body?: unknown; key?: string },
  ): Promise<unknown> {
    requireSelected(nodeId)
    const write = request.method !== 'GET'
    let response: NodeFetchResponse
    try {
      response = await broker.fetch(nodeId, {
        requestId: randomUUID(),
        path: request.path,
        method: request.method,
        headers: {
          ...(request.key ? { 'idempotency-key': request.key } : {}),
          ...(request.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(request.body !== undefined
          ? { body: { kind: 'bytes' as const, bytes: new TextEncoder().encode(JSON.stringify(request.body)) } }
          : {}),
      })
    } catch (error) {
      if (!write) requireSelected(nodeId)
      if (activeNodeId === nodeId && (await presentsAnotherCertificate(nodeId)) && activeNodeId === nodeId) {
        identityChanged = nodeId
        broker.remove(nodeId)
        options.status(changedIdentityStatus(nodeId))
        throw new BridgeFailure('identity_mismatch', 'The Node presented a different certificate. Pair it again.')
      }
      if (write)
        throw new BridgeFailure(
          'ambiguous_mutation',
          `The Node did not confirm the change, so it may or may not have happened: ${messageOf(error)}`,
        )
      requireSelected(nodeId)
      throw new BridgeFailure('node_unreachable', `The Node did not answer: ${messageOf(error)}`)
    }
    if (!write) requireSelected(nodeId)
    const body = parseJson(response)
    if (response.status === 401)
      throw new BridgeFailure('revoked', 'The Node no longer accepts this browser. Forget it and pair again.')
    if (response.status >= 400) {
      const message = (body as { error?: { message?: unknown } } | null)?.error?.message
      throw new BridgeFailure(
        response.status === 404 ? 'not_found' : 'node_error',
        typeof message === 'string' ? message : `The Node answered ${response.status}.`,
      )
    }
    return body
  }

  const readList = async <Row>(nodeId: string, path: string, rows: (body: unknown) => unknown): Promise<Row[]> => {
    const list = rows(await nodeRequest(nodeId, { method: 'GET', path }))
    if (!Array.isArray(list))
      throw new BridgeFailure('node_error', `The Node returned an unreadable list from ${path}.`)
    return list as Row[]
  }

  async function listProjects(nodeId: string): Promise<BridgeResults['projects.list']> {
    const rows = await readList<ProjectsResponse['projects'][number]>(
      nodeId,
      projectsRoute,
      (body) => (body as ProjectsResponse | null)?.projects,
    )
    const projects: BridgeProject[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      hidden: row.hidden,
    }))
    return { nodeId, projects }
  }

  // Active tasks only, in the Node's order. The route lists every project's, so this keeps one.
  async function listTasks(nodeId: string, projectId: string): Promise<BridgeResults['tasks.list']> {
    const rows = await readList<Task>(nodeId, tasksRoute, (body) => body)
    const tasks = rows
      .filter((task) => task.projectId === projectId)
      .map((task) => ({ id: task.id, title: task.title, branch: task.branch }))
    return { nodeId, projectId, tasks }
  }

  async function handle(request: BridgeRequest): Promise<BridgeResults[BridgeRequest['op']]> {
    switch (request.op) {
      case 'nodes.list':
        return nodes()
      case 'node.probe': {
        pending = null
        try {
          pending = await probe(request.endpoint)
        } catch (error) {
          const message = messageOf(error)
          if (/baseline|protocol/.test(message)) throw new BridgeFailure('incompatible', message)
          if (/certificate|fingerprint|intercept/.test(message)) throw new BridgeFailure('identity_mismatch', message)
          throw new BridgeFailure('node_unreachable', message)
        }
        const { certPem: _certPem, ...result } = pending
        return result
      }
      case 'node.pair': {
        const confirmed = pending
        if (!confirmed) throw new BridgeFailure('no_probe', 'Check the Node address and its identity before pairing.')
        if (!confirmed.compatible)
          throw new BridgeFailure('incompatible', 'That Node speaks a different protocol version.')
        let result: Awaited<ReturnType<typeof pairWithNode>>
        try {
          result = await pair(confirmed, { code: request.code, deviceName: options.deviceName })
        } catch (error) {
          throw new BridgeFailure('pairing_failed', messageOf(error))
        }
        pending = null
        // Pairing again replaces the pin and token. A selected node reconnects on the new credential.
        if (activeNodeId === result.nodeId) broker.remove(activeNodeId)
        const node = fleet.remember(
          {
            nodeId: result.nodeId,
            label: request.label,
            endpoint: confirmed.endpoint,
            fingerprint: confirmed.fingerprint,
            certPem: confirmed.certPem,
            deviceId: result.device.id,
            local: false,
          },
          result.deviceToken,
        )
        if (identityChanged === result.nodeId) identityChanged = null
        if (activeNodeId === result.nodeId) {
          activeNodeId = null
          select(result.nodeId)
        }
        return toNodeRecord(node)
      }
      case 'node.select':
        return select(request.nodeId)
      case 'node.forget':
        // This browser's custody only. The Node keeps the device row until someone revokes it there.
        if (activeNodeId === request.nodeId) select(null)
        fleet.forget(request.nodeId)
        return nodes()
      case 'projects.list':
        return listProjects(request.nodeId)
      case 'tasks.list':
        return listTasks(request.nodeId, request.projectId)
      case 'agents.profiles': {
        const rows = await readList<AgentProviderDescriptor>(request.nodeId, `${agentsRoute}/providers`, (b) => b)
        return { nodeId: request.nodeId, profiles: rows.map(bridgeProfile) }
      }
      case 'sessions.list': {
        // The newest hundred, which is one page of the route. Archived sessions are left out.
        const query = new URLSearchParams({ taskId: request.taskId, archived: 'false', limit: '100' })
        const rows = await readList<AgentSession>(
          request.nodeId,
          `${agentsRoute}/sessions?${query}`,
          (body) => (body as AgentSessionList | null)?.sessions,
        )
        return { nodeId: request.nodeId, taskId: request.taskId, sessions: rows.map(bridgeSession) }
      }
      case 'session.read': {
        const query = `?afterSeq=${request.afterSeq}&limit=${request.limit}&fold=1`
        const snapshot = (await nodeRequest(request.nodeId, {
          method: 'GET',
          path: `${sessionRoute(request.sessionId)}${query}`,
        })) as AgentSessionSnapshot | null
        if (!snapshot?.session || !Array.isArray(snapshot.events) || !Array.isArray(snapshot.turns))
          throw new BridgeFailure('node_error', 'The Node returned an unreadable session.')
        return bridgeSessionRead(request.nodeId, snapshot, request.afterSeq)
      }
      case 'session.create': {
        // Normal session defaults: no config, so the Node applies whatever any other client would get.
        const session = (await nodeRequest(request.nodeId, {
          method: 'POST',
          path: `${agentsRoute}/sessions`,
          key: request.key,
          body: {
            taskId: request.taskId,
            providerId: request.providerId,
            profileId: request.profileId,
            kind: 'interactive',
            config: {},
          },
        })) as AgentSession
        return { nodeId: request.nodeId, session: bridgeSession(session) }
      }
      case 'turn.submit': {
        const turn = (await nodeRequest(request.nodeId, {
          method: 'POST',
          path: `${sessionRoute(request.sessionId)}/turns`,
          key: request.key,
          body: { input: [{ type: 'text', text: request.text }], source: 'interactive', effectivePolicy: {} },
        })) as AgentTurn
        return { nodeId: request.nodeId, sessionId: request.sessionId, turnId: turn.id }
      }
    }
  }

  return {
    handle,
    dispose: () => {
      hints.dispose()
      broker.dispose()
    },
  }
}

const changedIdentityStatus = (nodeId: string): NodeStatus => ({
  nodeId,
  state: 'offline',
  error: { code: 'identity_mismatch' },
})

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function parseJson(response: NodeFetchResponse): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(response.body))
  } catch {
    return null
  }
}
