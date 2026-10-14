import { randomUUID } from 'node:crypto'
import { NodeBroker, toNodeRecord, type FleetStore } from '@acorn/custody/broker'
import { askToPair, collectPairing, pairWithNode, probeNode } from '@acorn/custody/broker/nodePairing.ts'
import { dataRootDir, runningNode } from '@acorn/custody/local'
import type { NodeFetchBody, NodeFetchResponse, NodeStatus } from '@acorn/protocol/broker.ts'
import {
  ATTACHMENT_MAX_BYTES,
  type BridgeAgentHint,
  type BridgeAttachment,
  type BridgeErrorCode,
  type BridgeNodes,
  type BridgeProject,
  type BridgeRequest,
  type BridgeResults,
} from '@acorn/protocol/extensionBridge.ts'
import {
  projectConfigRoute,
  projectsRoute,
  tasksRoute,
  type Project,
  type ProjectConfigResponse,
  type ProjectsResponse,
  type Task,
} from '@acorn/protocol/api.ts'
import {
  SITE_ASSOCIATIONS_MAX,
  associationMatches,
  matchingSiteProjects,
  sameSite,
  siteAssociationsSchema,
  type ProjectSite,
  type SiteAssociation,
} from '@acorn/protocol/siteAssociations.ts'
import {
  BROWSER_HANDOFF_RESOLUTION_MAX_BYTES,
  browserHandoffResolution,
  browserHandoffsRoute,
  matchHandoffPage,
  type BrowserHandoff,
  type BrowserHandoffResolution,
  type BrowserHandoffResolveRequest,
  type BrowserHandoffsResponse,
  TASK_ADDRESSES_MAX_BYTES,
  taskAddressList,
} from '@acorn/protocol/plugin/handoffs.ts'
import type {
  AgentAttachment,
  AgentInputPart,
  AgentOpenRequestList,
  AgentProviderDescriptor,
  AgentRequest,
  AgentSession,
  AgentSessionList,
  AgentSessionSnapshot,
  AgentTurn,
} from '@acorn/plugin-agents/contract/wire.ts'
import type { CustomAgent } from '@acorn/plugin-agents/contract/newSessionChoices.ts'
import {
  agentHints,
  agentsRoute,
  attachmentRoute,
  bridgeAttachment,
  bridgeChoices,
  bridgeRequest,
  bridgeSession,
  bridgeSessionRead,
  sessionRoute,
} from './agents'
import type { WorkflowDefSummary, WorkflowRunRow, WorkflowStepRow } from '@acorn/plugin-workflows/contract/wire.ts'
import {
  bridgeRuns,
  bridgeSteps,
  runStepsRoute,
  runnableWorkflows,
  stepTaskId,
  taskWorkflowsRoute,
  workflowDefsRoute,
} from './workflows'
import {
  bridgeHandoff,
  bridgeHandoffItem,
  creatableProjects,
  linkedTasks,
  ownsRoute,
  taskPages,
  type PublishedAddresses,
} from './handoffs'

export class BridgeFailure extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message)
  }
}

type Probe = Awaited<ReturnType<typeof probeNode>>

// How long `nodes.list` waits to learn whether an offline Node changed its certificate. A refused
// connection answers at once; a Node that accepts and then hangs costs at most this.
const LIST_PROBE_TIMEOUT_MS = 2_000

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
  // The selected Node's plugin set changed, so its browser handoffs may have.
  handoffsChanged?(nodeId: string): void
  // A project on the selected Node changed, so its site associations may have.
  projectsChanged?(nodeId: string): void
  // A task on the selected Node changed, so its page addresses may have.
  tasksChanged?(nodeId: string): void
  probe?: typeof probeNode
  pair?: typeof pairWithNode
  ask?: typeof askToPair
  collect?: typeof collectPairing
}) {
  const { fleet } = options
  const probe = options.probe ?? probeNode
  const pair = options.pair ?? pairWithNode
  const ask = options.ask ?? askToPair
  const collect = options.collect ?? collectPairing
  let activeNodeId: string | null = null
  // The selected Node presented a certificate other than its pin. Its connection is closed until the
  // person pairs it again, and its status says why rather than reading as an ordinary outage.
  let identityChanged: string | null = null
  // The probe is held here rather than returned, so pairing can only complete the endpoint whose
  // fingerprint the person was shown, or this computer's Node, pinned to the certificate in its files.
  let pending: Probe | null = null
  // Whether `pending` is this computer's Node, the only one `node.ask` may ask.
  let pendingLocal = false
  // An ask the owner hasn't answered. The secret stays in this process; the sidebar sees the phrase.
  let asking: { probe: Probe; secret: string } | null = null
  // The plugins whose task addresses the last `tasks.pages` read asked for.
  let addressPlugins = new Set<string>()
  const hints = agentHints(options.hint ?? (() => {}))
  const broker = new NodeBroker({
    frame(nodeId, frame) {
      if (nodeId !== activeNodeId) return
      hints.note(nodeId, frame)
      const channel = (frame as { channel?: unknown } | null)?.channel
      if (channel === 'plugins:changed') options.handoffsChanged?.(nodeId)
      if (channel === 'project:changed') options.projectsChanged?.(nodeId)
      if (channel === 'tasks:changed') options.tasksChanged?.(nodeId)
      // A plugin that publishes task addresses asks clients to read its status again when its state
      // changes, such as a stack coming up, so its addresses may have changed too.
      const pluginId = (frame as { pluginId?: unknown }).pluginId
      if (channel === 'term:status' && typeof pluginId === 'string' && addressPlugins.has(pluginId))
        options.tasksChanged?.(nodeId)
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
  async function presentsAnotherCertificate(nodeId: string, timeoutMs?: number): Promise<boolean> {
    const node = fleet.get(nodeId)
    if (!node?.fingerprint) return false
    try {
      // Both sides come from `probeNode`, which normalizes the fingerprint.
      return (await probe(node.endpoint, { timeoutMs })).fingerprint !== node.fingerprint
    } catch {
      return false
    }
  }

  // A probe whose failure the sidebar can explain. It sends no token and grants nothing.
  async function probeEndpoint(endpoint: string): Promise<Probe> {
    try {
      return await probe(endpoint)
    } catch (error) {
      const message = messageOf(error)
      if (/baseline|protocol/.test(message)) throw new BridgeFailure('incompatible', message)
      if (/certificate|fingerprint|intercept/.test(message)) throw new BridgeFailure('identity_mismatch', message)
      throw new BridgeFailure('node_unreachable', message)
    }
  }

  // A pairing that worked, by code or by approval: keep the pin and token, and reconnect if it's the
  // selected Node.
  function remember(confirmed: Probe, result: Awaited<ReturnType<typeof pairWithNode>>, label: string) {
    pending = null
    pendingLocal = false
    asking = null
    // Pairing again replaces the pin and token. A selected node reconnects on the new credential.
    if (activeNodeId === result.nodeId) broker.remove(activeNodeId)
    const node = fleet.remember(
      {
        nodeId: result.nodeId,
        label,
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

  // The Node in the data root `acorn` itself would open, found the way `openCliNode` finds it: the
  // endpoint from `node.json` and the certificate from `tls/cert.pem`. Only those files are read, never
  // a token. The address must present that same certificate, and the pin is the file's, so no one on
  // the network could have chosen it.
  async function probeLocalNode(): Promise<BridgeResults['node.local']> {
    let running: ReturnType<typeof runningNode>
    try {
      running = runningNode(dataRootDir())
    } catch (error) {
      throw new BridgeFailure('node_error', `The Node on this computer could not be read: ${messageOf(error)}`)
    }
    if (!running) return null
    const probed = await probeEndpoint(running.endpoint)
    if (probed.fingerprint !== running.fingerprint)
      throw new BridgeFailure(
        'identity_mismatch',
        'The Node on this computer presented a certificate other than the one in its data folder.',
      )
    pending = { ...probed, certPem: running.certPem }
    pendingLocal = true
    const { certPem: _certPem, ...result } = pending
    return { ...result, nodeId: running.nodeId }
  }

  // Stops at a changed certificate: the Node's connection closes until the person pairs it again.
  async function noticeChangedIdentity(nodeId: string, timeoutMs?: number): Promise<boolean> {
    if (identityChanged === nodeId) return true
    if (activeNodeId !== nodeId || !(await presentsAnotherCertificate(nodeId, timeoutMs)) || activeNodeId !== nodeId)
      return false
    identityChanged = nodeId
    broker.remove(nodeId)
    options.status(changedIdentityStatus(nodeId))
    return true
  }

  // One Node route for the selected node. A read is refused if the selection moved while it was out;
  // a write isn't, because once sent it may have happened, and the caller must hear its outcome.
  async function nodeResponse(
    nodeId: string,
    request: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE'
      path: string
      body?: unknown
      form?: Extract<NodeFetchBody, { kind: 'form' }>
      key?: string
      maxResponseBytes?: number
      // A POST that changes nothing, such as a handoff resolution, is a read: refused if the selection
      // moved while it was out, and never reported as an uncertain change.
      read?: boolean
    },
  ): Promise<NodeFetchResponse> {
    requireSelected(nodeId)
    const write = request.method !== 'GET' && !request.read
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
          : request.form
            ? { body: request.form }
            : {}),
        ...(request.maxResponseBytes ? { maxResponseBytes: request.maxResponseBytes } : {}),
      })
    } catch (error) {
      if (!write) requireSelected(nodeId)
      if (await noticeChangedIdentity(nodeId))
        throw new BridgeFailure('identity_mismatch', 'The Node presented a different certificate. Pair it again.')
      if (write)
        throw new BridgeFailure(
          'ambiguous_mutation',
          `The Node did not confirm the change, so it may or may not have happened: ${messageOf(error)}`,
        )
      requireSelected(nodeId)
      throw new BridgeFailure('node_unreachable', `The Node did not answer: ${messageOf(error)}`)
    }
    if (!write) requireSelected(nodeId)
    if (response.status === 401)
      throw new BridgeFailure('revoked', 'The Node no longer accepts this browser. Forget it and pair again.')
    if (response.status >= 400) {
      const message = (parseJson(response) as { error?: { message?: unknown } } | null)?.error?.message
      throw new BridgeFailure(
        response.status === 404 ? 'not_found' : 'node_error',
        typeof message === 'string' ? message : `The Node answered ${response.status}.`,
      )
    }
    return response
  }

  const nodeRequest = async (nodeId: string, request: Parameters<typeof nodeResponse>[1]): Promise<unknown> =>
    parseJson(await nodeResponse(nodeId, request))

  // An attachment of the named task. The agents routes confine a task's own agent to its task, but this
  // browser holds a device credential, which they don't confine, so the host checks the owner itself.
  // Another task's attachment reads as missing, the same answer the Node gives a confined caller.
  async function taskAttachment(nodeId: string, taskId: string, attachmentId: string): Promise<BridgeAttachment> {
    const row = (await nodeRequest(nodeId, { method: 'GET', path: attachmentRoute(attachmentId) })) as AgentAttachment
    if (row?.taskId !== taskId) throw new BridgeFailure('not_found', 'That attachment is not part of this task.')
    return bridgeAttachment(row)
  }

  const readList = async <Row>(nodeId: string, path: string, rows: (body: unknown) => unknown): Promise<Row[]> => {
    const list = rows(await nodeRequest(nodeId, { method: 'GET', path }))
    if (!Array.isArray(list))
      throw new BridgeFailure('node_error', `The Node returned an unreadable list from ${path}.`)
    return list as Row[]
  }

  // A task's newest hundred sessions, which is one page of the route. Archived sessions are left out.
  async function taskSessions(nodeId: string, taskId: string): Promise<AgentSession[]> {
    const query = new URLSearchParams({ taskId, archived: 'false', limit: '100' })
    return readList<AgentSession>(
      nodeId,
      `${agentsRoute}/sessions?${query}`,
      (body) => (body as AgentSessionList | null)?.sessions,
    )
  }

  async function listProjectRows(nodeId: string): Promise<Project[]> {
    return readList<Project>(nodeId, projectsRoute, (body) => (body as ProjectsResponse | null)?.projects)
  }

  async function listProjects(nodeId: string): Promise<BridgeResults['projects.list']> {
    const rows = await listProjectRows(nodeId)
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

  // One project's associations, read fresh from its config. A list that doesn't parse reads as none.
  async function projectSites(nodeId: string, projectId: string): Promise<SiteAssociation[]> {
    const body = (await nodeRequest(nodeId, {
      method: 'GET',
      path: projectConfigRoute(projectId),
    })) as ProjectConfigResponse | null
    const parsed = siteAssociationsSchema.safeParse(body?.config?.siteAssociations ?? [])
    return parsed.success ? parsed.data : []
  }

  // A project the Node no longer has has no associations.
  async function sitesOrNone(nodeId: string, projectId: string): Promise<SiteAssociation[]> {
    try {
      return await projectSites(nodeId, projectId)
    } catch (error) {
      if (error instanceof BridgeFailure && error.code === 'not_found') return []
      throw error
    }
  }

  // Every project's associations. The Node keeps them in each project's config and has no list across
  // projects, so this reads each one.
  async function allSites(nodeId: string, projects: readonly Project[]): Promise<ProjectSite[]> {
    const lists = await Promise.all(
      projects.map(async (project) =>
        (await sitesOrNone(nodeId, project.id)).map((site) => ({ projectId: project.id, ...site })),
      ),
    )
    return lists.flat()
  }

  // Reads the project's list, changes it, and writes it back whole, which is how the config route
  // takes it. Nothing is written when the change leaves the list as it was.
  async function changeSites(
    nodeId: string,
    projectId: string,
    change: (sites: SiteAssociation[]) => SiteAssociation[],
  ): Promise<BridgeResults['site.add']> {
    const current = await projectSites(nodeId, projectId)
    const next = change(current)
    if (next === current) return { nodeId, projectId, sites: current }
    if (next.length > SITE_ASSOCIATIONS_MAX)
      throw new BridgeFailure('bad_request', `A project can have at most ${SITE_ASSOCIATIONS_MAX} sites.`)
    const body = (await nodeRequest(nodeId, {
      method: 'PUT',
      path: projectConfigRoute(projectId),
      body: { patch: { siteAssociations: next } },
    })) as ProjectConfigResponse | null
    return { nodeId, projectId, sites: body?.config?.siteAssociations ?? next }
  }

  // The handoff the Node declares now, looked up for every call rather than trusted from the browser.
  async function declaredHandoff(nodeId: string, pluginId: string, handoffId: string): Promise<BrowserHandoff> {
    const body = (await nodeRequest(nodeId, { method: 'GET', path: browserHandoffsRoute })) as BrowserHandoffsResponse
    const handoff = body?.handoffs?.find((entry) => entry.pluginId === pluginId && entry.id === handoffId)
    if (!handoff || !ownsRoute(handoff.pluginId, handoff.resolve))
      throw new BridgeFailure('not_found', 'The Node no longer offers that handoff. Reload the page and try again.')
    return handoff
  }

  // Matches the page against the handoff's own patterns, calls its declared route, and holds the answer
  // to the shared schema before anything is built from it.
  async function resolveHandoff(
    nodeId: string,
    target: { pluginId: string; handoffId: string; url: string },
  ): Promise<BrowserHandoffResolution> {
    const handoff = await declaredHandoff(nodeId, target.pluginId, target.handoffId)
    const captures = matchHandoffPage(handoff, target.url)
    if (!captures) throw new BridgeFailure('bad_request', `“${handoff.label}” doesn't work on that page.`)
    const answer = await nodeRequest(nodeId, {
      method: 'POST',
      path: handoff.resolve,
      body: { url: target.url, captures } satisfies BrowserHandoffResolveRequest,
      read: true,
      maxResponseBytes: BROWSER_HANDOFF_RESOLUTION_MAX_BYTES,
    })
    const parsed = browserHandoffResolution.safeParse(answer)
    if (!parsed.success)
      throw new BridgeFailure(
        'node_error',
        `The ${handoff.pluginId} plugin answered with something the extension can't use.`,
      )
    return parsed.data
  }

  // Where each plugin that publishes task addresses says its tasks' apps answer now. A plugin whose
  // route fails or answers something unusable adds nothing, so one broken plugin can't take every
  // task's pages with it; the task list read beside this reports a Node that is gone.
  async function publishedAddresses(nodeId: string): Promise<PublishedAddresses[]> {
    const body = (await nodeRequest(nodeId, { method: 'GET', path: browserHandoffsRoute })) as BrowserHandoffsResponse
    const routes = (body?.taskAddresses ?? []).filter(({ pluginId, route }) => ownsRoute(pluginId, route))
    addressPlugins = new Set(routes.map((route) => route.pluginId))
    const answers = await Promise.all(
      routes.map(async ({ pluginId, route }): Promise<PublishedAddresses[]> => {
        try {
          const answer = await nodeRequest(nodeId, {
            method: 'GET',
            path: route,
            maxResponseBytes: TASK_ADDRESSES_MAX_BYTES,
          })
          const parsed = taskAddressList.safeParse(answer)
          return parsed.success ? [{ pluginId, addresses: parsed.data.addresses }] : []
        } catch {
          return []
        }
      }),
    )
    return answers.flat()
  }

  async function handle(request: BridgeRequest): Promise<BridgeResults[BridgeRequest['op']]> {
    switch (request.op) {
      case 'nodes.list': {
        // The broker reports a regenerated certificate as offline and keeps retrying quietly, so an
        // offline Node is probed whenever the sidebar asks, which it does each time it opens. The answer
        // goes in this reply: a sidebar that has just opened ignores status events until it has the
        // list. The short timeout bounds the wait on a Node that is asleep rather than changed.
        if (activeNodeId && nodes().status?.state === 'offline')
          await noticeChangedIdentity(activeNodeId, LIST_PROBE_TIMEOUT_MS)
        return nodes()
      }
      case 'node.probe': {
        pending = null
        pendingLocal = false
        asking = null
        pending = await probeEndpoint(request.endpoint)
        const { certPem: _certPem, ...result } = pending
        return result
      }
      case 'node.local':
        pending = null
        pendingLocal = false
        asking = null
        return probeLocalNode()
      case 'node.pair': {
        const confirmed = pending
        if (!confirmed) throw new BridgeFailure('no_probe', 'Choose a Node and check its identity before pairing.')
        if (!confirmed.compatible)
          throw new BridgeFailure('incompatible', 'That Node speaks a different protocol version.')
        let result: Awaited<ReturnType<typeof pairWithNode>>
        try {
          result = await pair(confirmed, { code: request.code, deviceName: options.deviceName })
        } catch (error) {
          throw new BridgeFailure('pairing_failed', messageOf(error))
        }
        return remember(confirmed, result, request.label)
      }
      case 'node.ask': {
        const local = pending
        if (!local || !pendingLocal)
          throw new BridgeFailure('no_probe', 'Find the Node on this computer before asking it to pair.')
        if (!local.compatible) throw new BridgeFailure('incompatible', 'That Node speaks a different protocol version.')
        const asked = await ask(local, options.deviceName).catch(() => null)
        if (!asked)
          throw new BridgeFailure(
            'pairing_failed',
            'The Node on this computer could not take a request. Use a pairing code.',
          )
        asking = { probe: local, secret: asked.secret }
        return { phrase: asked.phrase }
      }
      case 'node.collect': {
        const current = asking
        if (!current) throw new BridgeFailure('no_probe', 'Ask the Node on this computer to pair first.')
        let result: Awaited<ReturnType<typeof collectPairing>>
        try {
          result = await collect(current.probe, current.secret)
        } catch (error) {
          asking = null
          throw new BridgeFailure('pairing_failed', messageOf(error))
        }
        return result ? remember(current.probe, result, request.label) : null
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
      case 'tasks.pages': {
        const [tasks, published] = await Promise.all([
          readList<Task>(request.nodeId, tasksRoute, (body) => body),
          publishedAddresses(request.nodeId),
        ])
        return { nodeId: request.nodeId, tasks: taskPages(tasks, published) }
      }
      case 'agents.choices': {
        const [providers, agents] = await Promise.all([
          readList<AgentProviderDescriptor>(
            request.nodeId,
            `${agentsRoute}/providers${request.refresh ? '?force=true' : ''}`,
            (b) => b,
          ),
          // Without the custom agents the picker still offers every harness, as the desktop's does.
          readList<CustomAgent>(request.nodeId, `${agentsRoute}/custom-agents`, (b) => b).catch((error: unknown) => {
            if (error instanceof BridgeFailure && error.code !== 'node_error' && error.code !== 'not_found') throw error
            return []
          }),
        ])
        return { nodeId: request.nodeId, choices: bridgeChoices(providers, agents) }
      }
      case 'sessions.list': {
        const rows = await taskSessions(request.nodeId, request.taskId)
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
            ...(request.customAgentId ? { customAgentId: request.customAgentId } : {}),
            ...(request.account ? { account: request.account } : {}),
            config: {},
          },
        })) as AgentSession
        return { nodeId: request.nodeId, session: bridgeSession(session) }
      }
      case 'turn.submit': {
        const input: AgentInputPart[] = request.input
        const turn = (await nodeRequest(request.nodeId, {
          method: 'POST',
          path: `${sessionRoute(request.sessionId)}/turns`,
          key: request.key,
          body: { input, source: 'interactive', effectivePolicy: {} },
        })) as AgentTurn
        return { nodeId: request.nodeId, sessionId: request.sessionId, turnId: turn.id }
      }
      case 'request.resolve': {
        // The Node settles a request once. An answer to one already settled, from here or another
        // client, comes back as that settled row and reaches no agent.
        const row = (await nodeRequest(request.nodeId, {
          method: 'POST',
          path: `${sessionRoute(request.sessionId)}/requests/${encodeURIComponent(request.requestId)}/resolve`,
          key: request.key,
          body: { resolution: request.resolution },
        })) as AgentRequest
        return { nodeId: request.nodeId, sessionId: request.sessionId, request: bridgeRequest(row) }
      }
      case 'requests.pending': {
        // One read of the Node's open requests, placed in a project through the active task list. A
        // request whose task isn't active has no conversation to open, so it isn't counted.
        const body = (await nodeRequest(request.nodeId, {
          method: 'GET',
          path: `${agentsRoute}/requests`,
        })) as AgentOpenRequestList | null
        if (!Array.isArray(body?.requests))
          throw new BridgeFailure('node_error', 'The Node returned an unreadable list of requests.')
        const tasks = new Map(
          (await readList<Task>(request.nodeId, tasksRoute, (rows) => rows)).map((task) => [task.id, task]),
        )
        return {
          nodeId: request.nodeId,
          requests: body.requests.flatMap((row) => {
            const task = tasks.get(row.taskId)
            return task
              ? [
                  {
                    requestId: row.providerRequestId,
                    sessionId: row.sessionId,
                    taskId: row.taskId,
                    projectId: task.projectId,
                    kind: row.kind,
                    title: row.title,
                    taskTitle: task.title,
                  },
                ]
              : []
          }),
        }
      }
      case 'attachment.upload': {
        const bytes = Buffer.from(request.data, 'base64')
        if (bytes.byteLength > ATTACHMENT_MAX_BYTES)
          throw new BridgeFailure('bad_request', 'Attachments are limited to 10 MiB each.')
        const query = new URLSearchParams({ taskId: request.taskId })
        const row = (await nodeRequest(request.nodeId, {
          method: 'POST',
          path: `${agentsRoute}/attachments?${query}`,
          form: {
            kind: 'form',
            parts: [{ name: 'file', filename: request.filename, type: request.mediaType, bytes }],
          },
        })) as AgentAttachment
        return { nodeId: request.nodeId, taskId: request.taskId, attachment: bridgeAttachment(row) }
      }
      case 'attachment.read': {
        const attachment = await taskAttachment(request.nodeId, request.taskId, request.attachmentId)
        if (!attachment.mediaType.startsWith('image/') || attachment.byteSize > ATTACHMENT_MAX_BYTES)
          return { nodeId: request.nodeId, taskId: request.taskId, attachment, data: null }
        const content = await nodeResponse(request.nodeId, {
          method: 'GET',
          path: `${attachmentRoute(request.attachmentId)}/content`,
          maxResponseBytes: ATTACHMENT_MAX_BYTES,
        })
        const data = Buffer.from(content.body).toString('base64')
        return { nodeId: request.nodeId, taskId: request.taskId, attachment, data }
      }
      case 'handoffs.list': {
        const body = (await nodeRequest(request.nodeId, {
          method: 'GET',
          path: browserHandoffsRoute,
        })) as BrowserHandoffsResponse | null
        if (!Array.isArray(body?.handoffs))
          throw new BridgeFailure('node_error', 'The Node returned an unreadable list of handoffs.')
        return {
          nodeId: request.nodeId,
          handoffs: body.handoffs.filter((handoff) => ownsRoute(handoff.pluginId, handoff.resolve)).map(bridgeHandoff),
        }
      }
      case 'handoff.resolve': {
        const resolution = await resolveHandoff(request.nodeId, request)
        const projects = await listProjectRows(request.nodeId)
        const tasks = await readList<Task>(request.nodeId, tasksRoute, (body) => body)
        const siteProjects = matchingSiteProjects(await allSites(request.nodeId, projects), request.url)
        return {
          nodeId: request.nodeId,
          url: request.url,
          items: resolution.items.map((item) => bridgeHandoffItem(item, projects, tasks, siteProjects)),
        }
      }
      case 'handoff.create': {
        // The browser names the item and the project; the seed comes from the provider's fresh answer.
        const resolution = await resolveHandoff(request.nodeId, request)
        const item = resolution.items.find(
          (candidate) =>
            candidate.identifier === request.identifier && candidate.connection.id === request.connectionId,
        )
        if (!item) throw new BridgeFailure('not_found', 'The page no longer resolves to that item. Open it again.')
        const siteProject = (await sitesOrNone(request.nodeId, request.projectId)).some((site) =>
          associationMatches(site, request.url),
        )
        if (!creatableProjects(item, siteProject ? [request.projectId] : []).includes(request.projectId))
          throw new BridgeFailure(
            'bad_request',
            `That project doesn't track ${item.identifier}, so no task was made in it.`,
          )
        // A repeated create, or one made elsewhere since the person looked, answers the linked task.
        const tasks = await readList<Task>(request.nodeId, tasksRoute, (body) => body)
        const existing = linkedTasks(item, tasks).find((task) => task.projectId === request.projectId)
        const task =
          existing ??
          ((await nodeRequest(request.nodeId, {
            method: 'POST',
            path: tasksRoute,
            key: request.key,
            body: { ...item.seed, projectId: request.projectId },
          })) as Task)
        return {
          nodeId: request.nodeId,
          task: { id: task.id, title: task.title, branch: task.branch, projectId: task.projectId },
          created: !existing,
        }
      }
      case 'sites.list': {
        const projects = await listProjectRows(request.nodeId)
        return { nodeId: request.nodeId, sites: await allSites(request.nodeId, projects) }
      }
      case 'site.add':
        return changeSites(request.nodeId, request.projectId, (sites) =>
          sites.some((site) => sameSite(site, request.site)) ? sites : [...sites, request.site],
        )
      case 'site.remove':
        return changeSites(request.nodeId, request.projectId, (sites) =>
          sites.some((site) => sameSite(site, request.site))
            ? sites.filter((site) => !sameSite(site, request.site))
            : sites,
        )
      case 'workflows.list': {
        const project = (await listProjectRows(request.nodeId)).find((row) => row.id === request.projectId)
        if (!project) throw new BridgeFailure('not_found', 'That project is no longer on this Node.')
        const body = (await nodeRequest(request.nodeId, {
          method: 'GET',
          path: workflowDefsRoute(project.workspaceId),
        })) as { workflows?: WorkflowDefSummary[] } | null
        if (!Array.isArray(body?.workflows))
          throw new BridgeFailure('node_error', 'The Node returned an unreadable list of workflows.')
        return {
          nodeId: request.nodeId,
          projectId: request.projectId,
          workflows: runnableWorkflows(body.workflows, request.projectId),
        }
      }
      case 'workflow.start': {
        // The route answers a refusal it understood as `error` in a 200, as the desktop reads it.
        const result = (await nodeRequest(request.nodeId, {
          method: 'POST',
          path: taskWorkflowsRoute(request.taskId),
          key: request.key,
          body: { defId: request.defId, ...(request.inputs ? { inputs: request.inputs } : {}) },
        })) as { runId?: unknown; error?: unknown } | null
        if (result?.error === 'needs-trust')
          throw new BridgeFailure(
            'node_error',
            "This workflow is in the repository's own config, which Acorn doesn't trust yet. Start it once in Acorn to trust it.",
          )
        if (typeof result?.error === 'string') throw new BridgeFailure('node_error', result.error)
        if (typeof result?.runId !== 'string')
          throw new BridgeFailure(
            'ambiguous_mutation',
            'The Node did not confirm the run, so it may or may not have started.',
          )
        return { nodeId: request.nodeId, taskId: request.taskId, runId: result.runId }
      }
      case 'workflow.runs': {
        const runs = await readList<WorkflowRunRow>(
          request.nodeId,
          `${taskWorkflowsRoute(request.taskId)}/runs`,
          (b) => b,
        )
        return { nodeId: request.nodeId, taskId: request.taskId, runs: bridgeRuns(runs) }
      }
      case 'workflow.steps': {
        const steps = await readList<WorkflowStepRow>(request.nodeId, runStepsRoute(request.runId), (body) => body)
        // The run's task, and the task of each step the runner gave one of its own.
        const taskIds = new Set([request.taskId, ...steps.flatMap((step) => stepTaskId(step) ?? [])])
        const sessions = (await Promise.all([...taskIds].map((taskId) => taskSessions(request.nodeId, taskId)))).flat()
        return { nodeId: request.nodeId, runId: request.runId, steps: bridgeSteps(steps, sessions, bridgeSession) }
      }
      case 'attachment.delete': {
        await taskAttachment(request.nodeId, request.taskId, request.attachmentId)
        const result = (await nodeRequest(request.nodeId, {
          method: 'DELETE',
          path: attachmentRoute(request.attachmentId),
        })) as { removed?: unknown } | null
        return {
          nodeId: request.nodeId,
          taskId: request.taskId,
          attachmentId: request.attachmentId,
          removed: result?.removed === true,
        }
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
