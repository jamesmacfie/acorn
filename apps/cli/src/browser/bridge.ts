import { randomUUID } from 'node:crypto'
import { NodeBroker, toNodeRecord, type FleetStore } from '@acorn/custody/broker'
import {
  askToPair,
  collectPairing,
  PairingBusyError,
  pairWithNode,
  probeNode,
} from '@acorn/custody/broker/nodePairing.ts'
import { dataRootDir, runningNode } from '@acorn/custody/local'
import type { NodeFetchBody, NodeFetchResponse, NodeStatus } from '@acorn/protocol/broker.ts'
import type { ArchiveResult, DeleteResult } from '@acorn/protocol/task.ts'
import {
  ATTACHMENT_MAX_BYTES,
  NATIVE_REPLY_MAX_CHARS,
  type BridgeAgentHint,
  type BridgeAttachment,
  type BridgeErrorCode,
  type BridgeNodes,
  type BridgePanel,
  type BridgeProject,
  type BridgeRequest,
  type BridgeResults,
} from '@acorn/protocol/extensionBridge.ts'
import {
  projectConfigRoute,
  projectsRoute,
  taskArchiveRoute,
  taskDeleteRoute,
  tasksRoute,
  workspacesRoute,
  type Project,
  type ProjectConfigResponse,
  type ProjectsResponse,
  type Task,
  type Workspace,
} from '@acorn/protocol/api.ts'
import { panelPlanSchema, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import { readPanelShowCall } from '@acorn/protocol/panelShowCall.ts'
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
  BROWSER_PANEL_MAX_BYTES,
  browserHandoffResolution,
  browserHandoffsRoute,
  matchHandoffPage,
  type BrowserHandoff,
  type BrowserHandoffResolution,
  type BrowserHandoffResolveRequest,
  type BrowserHandoffsResponse,
  type BrowserPanel,
  type BrowserPanelView,
  browserPanelView,
  pluginIcon,
  type PluginIcon,
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
  AgentToolCallRead,
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
  toolCallRoute,
} from './agents'
import {
  appRestoreRoute,
  appRevisionRoute,
  appRoute,
  appStateRoute,
  bridgeAppSummary,
  revisionFiles,
  type AppRevisionBody,
  type AppSummaryBody,
} from './apps'
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

const dashboardRunRoute = '/v1/core/dashboards/run'
const dataSourceActRoute = '/v1/core/data-sources/act'

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
  // The plugins whose state the sidebar shows, as the last `tasks.pages` read found them: those that
  // publish task addresses, and those that declare a panel.
  let statusPlugins = new Set<string>()
  const hints = agentHints(options.hint ?? (() => {}))
  const broker = new NodeBroker({
    frame(nodeId, frame) {
      if (nodeId !== activeNodeId) return
      hints.note(nodeId, frame)
      const channel = (frame as { channel?: unknown } | null)?.channel
      if (channel === 'plugins:changed') options.handoffsChanged?.(nodeId)
      // A workspace rename or a project moved between workspaces changes Home's task list too.
      if (channel === 'project:changed' || channel === 'workspace:changed') options.projectsChanged?.(nodeId)
      if (channel === 'tasks:changed') options.tasksChanged?.(nodeId)
      // A plugin that publishes task addresses or a panel asks clients to read its status again when its
      // state changes, such as a stack coming up, so its addresses and panel may have changed too.
      const pluginId = (frame as { pluginId?: unknown }).pluginId
      if (channel === 'term:status' && typeof pluginId === 'string' && statusPlugins.has(pluginId))
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
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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

  // The newest 100 unarchived sessions, the most the Node's route returns.
  async function listSessions(
    nodeId: string,
    scope: { taskId: string } | { workspaceId: string },
  ): Promise<AgentSession[]> {
    const query = new URLSearchParams({ ...scope, archived: 'false', limit: '100' })
    return readList<AgentSession>(
      nodeId,
      `${agentsRoute}/sessions?${query}`,
      (body) => (body as AgentSessionList | null)?.sessions,
    )
  }

  async function listProjectRows(nodeId: string): Promise<Project[]> {
    return readList<Project>(nodeId, projectsRoute, (body) => (body as ProjectsResponse | null)?.projects)
  }

  // Workspaces in the order the desktop's rail shows them.
  async function listProjects(nodeId: string): Promise<BridgeResults['projects.list']> {
    const [rows, groups] = await Promise.all([
      listProjectRows(nodeId),
      readList<Workspace>(nodeId, workspacesRoute, (body) => body),
    ])
    const projects: BridgeProject[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      hidden: row.hidden,
      workspaceId: row.workspaceId,
    }))
    const workspaces = groups.toSorted((a, b) => a.sort - b.sort).map((group) => ({ id: group.id, name: group.name }))
    return { nodeId, projects, workspaces }
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
  // What plugins published for their tasks, and the code hosts the Node runs, from one discovery read.
  async function publishedAddresses(nodeId: string): Promise<{ published: PublishedAddresses[]; codeHosts: string[] }> {
    const body = (await nodeRequest(nodeId, { method: 'GET', path: browserHandoffsRoute })) as BrowserHandoffsResponse
    const routes = (body?.taskAddresses ?? []).filter(({ pluginId, route }) => ownsRoute(pluginId, route))
    statusPlugins = new Set([...routes, ...declaredPanels(body)].map((entry) => entry.pluginId))
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
    return { published: answers.flat(), codeHosts: body?.codeHosts ?? [] }
  }

  // A plugin's sidebar view for one task, from the route the Node declares now, never one the browser
  // names. A plugin with no panel, or none for this task, answers null.
  async function pluginPanel(
    nodeId: string,
    target: { pluginId: string; taskId: string; source?: string },
  ): Promise<BrowserPanelView | null> {
    const body = (await nodeRequest(nodeId, { method: 'GET', path: browserHandoffsRoute })) as BrowserHandoffsResponse
    const panel = declaredPanels(body).find((entry) => entry.pluginId === target.pluginId)
    if (!panel) return null
    const query = new URLSearchParams({ taskId: target.taskId, ...(target.source ? { source: target.source } : {}) })
    let answer: unknown
    try {
      answer = await nodeRequest(nodeId, {
        method: 'GET',
        path: `${panel.route}${panel.route.includes('?') ? '&' : '?'}${query}`,
        maxResponseBytes: BROWSER_PANEL_MAX_BYTES,
      })
    } catch (error) {
      if (error instanceof BridgeFailure && error.code === 'not_found') return null
      throw error
    }
    const parsed = browserPanelView.safeParse(answer)
    if (!parsed.success)
      throw new BridgeFailure(
        'node_error',
        `The ${panel.pluginId} plugin answered with something the extension can't use.`,
      )
    return parsed.data
  }

  // A task, with its workspace, while it's active. Null once it's archived.
  async function activeTask(
    nodeId: string,
    taskId: string | undefined,
  ): Promise<{ task: Task; workspaceId: string } | null> {
    const [tasks, projects] = await Promise.all([
      readList<Task>(nodeId, tasksRoute, (body) => body),
      listProjectRows(nodeId),
    ])
    const task = tasks.find((candidate) => candidate.id === taskId)
    const workspaceId = projects.find((project) => project.id === task?.projectId)?.workspaceId
    return task && workspaceId ? { task, workspaceId } : null
  }

  // A plan run as a draft, as the desktop runs an agent's panel and an app's plans, with the plan beside
  // it in the reply.
  async function runDraftPlan(
    nodeId: string,
    workspaceId: string,
    plan: PanelPlan,
    request: { viewerZone: string; inputs?: Record<string, unknown> },
  ): Promise<unknown> {
    const run = (await nodeRequest(nodeId, {
      method: 'POST',
      path: dashboardRunRoute,
      body: {
        operation: 'run',
        scope: { workspaceId },
        target: { kind: 'draft', content: plan },
        mode: 'execution',
        viewerZone: request.viewerZone,
        ...(request.inputs ? { inputs: request.inputs } : {}),
      },
      read: true,
      // The reply carries the plan beside the run, and the whole reply must fit the extension's limit.
      maxResponseBytes: NATIVE_REPLY_MAX_CHARS - JSON.stringify(plan).length,
    })) as { rows?: unknown } | null
    if (!Array.isArray(run?.rows)) throw new BridgeFailure('node_error', 'The Node returned an unreadable panel run.')
    return run
  }

  // An agent's panel, as the desktop's card runs it: the plan from the call's input, as a draft, in the
  // workspace of the session's task. The browser names the call, so it can only run a plan an agent
  // showed in a session this device can read.
  async function shownPanel(
    nodeId: string,
    sessionId: string,
    toolId: string,
  ): Promise<{ plan: PanelPlan; workspaceId: string }> {
    const read = (await nodeRequest(nodeId, {
      method: 'GET',
      path: toolCallRoute(sessionId, toolId),
      maxResponseBytes: NATIVE_REPLY_MAX_CHARS,
    })) as AgentToolCallRead | null
    const tool = read?.tool
    const { input, result } = tool ? readPanelShowCall(tool) : {}
    if (tool?.name !== 'panel_show' || tool.status !== 'completed' || !input || !result)
      throw new BridgeFailure('not_found', "That call didn't draw a panel.")
    const parsed = panelPlanSchema.safeParse(input.plan)
    if (!parsed.success)
      throw new BridgeFailure('not_found', `${input.title} no longer passes its checks, so it can't be drawn.`)
    const active = await activeTask(nodeId, read?.taskId)
    if (!active) throw new BridgeFailure('not_found', "This conversation's task is no longer active.")
    // The agent's title is what the card says, as on the desktop's card.
    return { plan: { ...parsed.data, title: input.title }, workspaceId: active.workspaceId }
  }

  // An app of the named task. The trellis routes don't confine a device to a task, so the host checks
  // the owner itself, as it does for an attachment. Another task's app reads as missing.
  async function taskApp(nodeId: string, taskId: string, appId: string): Promise<AppSummaryBody> {
    const summary = (await nodeRequest(nodeId, { method: 'GET', path: appRoute(appId) })) as AppSummaryBody | null
    if (!summary || summary.taskId !== taskId)
      throw new BridgeFailure('not_found', 'That app is not part of this task.')
    return summary
  }

  const appRevision = revisionFiles(async (nodeId, appId, revision) => {
    const files = (await nodeRequest(nodeId, {
      method: 'GET',
      path: appRevisionRoute(appId, revision),
      maxResponseBytes: NATIVE_REPLY_MAX_CHARS,
    })) as AppRevisionBody | null
    if (typeof files?.program !== 'string' || !files.plans || typeof files.plans !== 'object')
      throw new BridgeFailure('node_error', 'The Node returned an unreadable app revision.')
    return files
  })

  // One of an app's plans, as the desktop's app runs it. The browser names the plan, and the host takes
  // it from the revision's own files, so the browser can't run a plan of its own. `head` asks that the
  // revision be the app's head, because an older one is read only.
  async function appPlan(
    nodeId: string,
    target: { taskId: string; appId: string; revision: number; plan: string },
    head = false,
  ): Promise<{ plan: PanelPlan; workspaceId: string }> {
    const { taskId, appId, revision } = target
    const summary = await taskApp(nodeId, taskId, appId)
    if (head && summary.head !== revision)
      throw new BridgeFailure(
        'not_found',
        `v${revision} of this app is read only, because v${summary.head} replaced it.`,
      )
    const [files, active] = await Promise.all([appRevision(nodeId, appId, revision), activeTask(nodeId, taskId)])
    if (!Object.hasOwn(files.plans, target.plan))
      throw new BridgeFailure('not_found', `This app has no plan called ${target.plan}.`)
    const parsed = panelPlanSchema.safeParse(files.plans[target.plan])
    if (!parsed.success)
      throw new BridgeFailure('not_found', `The plan ${target.plan} no longer passes its checks, so it can't run.`)
    if (!active) throw new BridgeFailure('not_found', "This conversation's task is no longer active.")
    return { plan: parsed.data, workspaceId: active.workspaceId }
  }

  // A data source action on a row of a card. The row and action come from a fresh run of the card's
  // plan, never from the browser, as the desktop's app takes them from its own last run. A row that's
  // gone, or no longer offers the action, is refused rather than matched to another.
  async function actOnRow(request: Extract<BridgeRequest, { op: 'row.act' }>): Promise<BridgeResults['row.act']> {
    const { nodeId, target } = request
    const { plan, workspaceId } =
      target.kind === 'panel'
        ? await shownPanel(nodeId, target.sessionId, target.toolId)
        : await appPlan(nodeId, target, true)
    const run = (await runDraftPlan(nodeId, workspaceId, plan, {
      viewerZone: request.viewerZone,
      ...(target.kind === 'app' ? { inputs: target.inputs } : {}),
    })) as { rows: { id?: unknown; records?: unknown[]; actions?: { id?: unknown }[] }[] }
    const row = run.rows.find((candidate) => candidate.id === request.rowId)
    const record = row?.records?.[0]
    if (!record || !row?.actions?.some((action) => action.id === request.actionId))
      throw new BridgeFailure('not_found', 'That row changed. Refresh and try again.')
    const answer = (await nodeRequest(nodeId, {
      method: 'POST',
      path: dataSourceActRoute,
      body: { ref: record, actionId: request.actionId, confirmedRisk: request.confirmedRisk },
      key: request.key,
    })) as BridgeResults['row.act'] | null
    if (typeof answer?.outcome !== 'string')
      throw new BridgeFailure('node_error', 'The Node returned an unreadable action outcome.')
    return { nodeId, outcome: answer.outcome, ...(answer.action ? { action: answer.action } : {}) }
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
        const asked = await ask(local, options.deviceName).catch((error: unknown) => {
          if (error instanceof PairingBusyError) throw new BridgeFailure('pairing_busy', error.message)
          return null
        })
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
      case 'node.rename':
        if (!fleet.rename(request.nodeId, request.label))
          throw new BridgeFailure('unknown_node', 'This browser has not paired that Node.')
        return nodes()
      case 'projects.list':
        return listProjects(request.nodeId)
      case 'tasks.pages': {
        const [tasks, { published, codeHosts }] = await Promise.all([
          readList<Task>(request.nodeId, tasksRoute, (body) => body),
          publishedAddresses(request.nodeId),
        ])
        return { nodeId: request.nodeId, tasks: taskPages(tasks, published, codeHosts) }
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
        // The schema lets through exactly one of the two.
        const scope = request.taskId ? { taskId: request.taskId } : { workspaceId: request.workspaceId! }
        const rows = await listSessions(request.nodeId, scope)
        return { nodeId: request.nodeId, ...scope, sessions: rows.map(bridgeSession) }
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
      case 'session.archive': {
        await nodeRequest(request.nodeId, {
          method: 'PATCH',
          path: sessionRoute(request.sessionId),
          key: request.key,
          body: { archived: true },
        })
        return { nodeId: request.nodeId, sessionId: request.sessionId }
      }
      case 'task.archive':
      case 'task.delete': {
        // No `force`, so the Node refuses a worktree with uncommitted changes rather than discard them.
        const result = (await nodeRequest(request.nodeId, {
          method: 'POST',
          path: request.op === 'task.archive' ? taskArchiveRoute(request.taskId) : taskDeleteRoute(request.taskId),
          key: request.key,
          body: request.op === 'task.archive' ? { deleteWorktree: true } : {},
        })) as ArchiveResult | DeleteResult | null
        if (!result?.ok)
          throw new BridgeFailure('node_error', result?.reason ?? 'The Node returned an unreadable answer.')
        const taskIds = 'taskIds' in result ? result.taskIds : (result.archivedTaskIds ?? [request.taskId])
        return { nodeId: request.nodeId, taskIds }
      }
      case 'session.cancel': {
        await nodeRequest(request.nodeId, {
          method: 'POST',
          path: `${sessionRoute(request.sessionId)}/cancel`,
          key: request.key,
          body: {},
        })
        return { nodeId: request.nodeId, sessionId: request.sessionId }
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
          panels: declaredPanels(body).map(bridgePanel),
          icons: declaredIcons(body),
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
        const sessions = (
          await Promise.all([...taskIds].map((taskId) => listSessions(request.nodeId, { taskId })))
        ).flat()
        return { nodeId: request.nodeId, runId: request.runId, steps: bridgeSteps(steps, sessions, bridgeSession) }
      }
      case 'panel.run': {
        const { nodeId, sessionId, toolId } = request
        const { plan, workspaceId } = await shownPanel(nodeId, sessionId, toolId)
        const run = await runDraftPlan(nodeId, workspaceId, plan, request)
        return { nodeId, sessionId, toolId, plan, run }
      }
      case 'app.view': {
        const { nodeId, taskId, appId, revision } = request
        const summary = await taskApp(nodeId, taskId, appId)
        const [files, active] = await Promise.all([appRevision(nodeId, appId, revision), activeTask(nodeId, taskId)])
        const task = active && { id: active.task.id, title: active.task.title, branch: active.task.branch }
        return {
          nodeId,
          appId,
          revision,
          summary: bridgeAppSummary(summary),
          program: files.program,
          plans: Object.keys(files.plans),
          task,
        }
      }
      case 'app.run': {
        const { nodeId, appId, revision } = request
        const { plan, workspaceId } = await appPlan(nodeId, request)
        const run = await runDraftPlan(nodeId, workspaceId, plan, request)
        return { nodeId, appId, revision, plan, run }
      }
      case 'row.act':
        return actOnRow(request)
      case 'app.state': {
        const { nodeId, taskId, appId, state, key } = request
        await taskApp(nodeId, taskId, appId)
        if (state === undefined) {
          const body = (await nodeRequest(nodeId, { method: 'GET', path: appStateRoute(appId) })) as {
            state?: Record<string, unknown>
          } | null
          return { nodeId, appId, state: body?.state ?? {} }
        }
        await nodeRequest(nodeId, { method: 'PUT', path: appStateRoute(appId), body: { state }, key })
        return { nodeId, appId, state: null }
      }
      case 'app.restore': {
        const { nodeId, taskId, appId, revision, key } = request
        await taskApp(nodeId, taskId, appId)
        const body = (await nodeRequest(nodeId, {
          method: 'POST',
          path: appRestoreRoute(appId),
          body: { revision },
          key,
        })) as { revision?: unknown } | null
        if (typeof body?.revision !== 'number')
          throw new BridgeFailure('node_error', 'The Node returned an unreadable restore.')
        return { nodeId, appId, revision: body.revision }
      }
      case 'plugin.panel': {
        const view = await pluginPanel(request.nodeId, request)
        return { nodeId: request.nodeId, pluginId: request.pluginId, taskId: request.taskId, view }
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

// The panels discovery lists whose route stays inside their own plugin's namespace.
const declaredPanels = (body: BrowserHandoffsResponse | null): BrowserPanel[] =>
  (Array.isArray(body?.panels) ? body.panels : []).filter((panel) => ownsRoute(panel.pluginId, panel.route))

const bridgePanel = ({ route: _route, ...panel }: BrowserPanel): BridgePanel => panel

// The logos discovery lists that pass the manifest's own rule, because a logo's colour reaches a style
// in the sidebar. A Node from before logos were listed sends none.
const declaredIcons = (body: BrowserHandoffsResponse | null): PluginIcon[] =>
  (Array.isArray(body?.icons) ? body.icons : []).flatMap((icon) => {
    const parsed = pluginIcon.safeParse(icon)
    return parsed.success ? [parsed.data] : []
  })

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
