import { BIND_CAPABILITY_CALLER } from '@acorn/protocol/plugin/ids.ts'
import { slackDeliverySchema } from '@acorn/protocol/account.ts'
import { redactSecretText, type NodePlugin } from '@acorn/plugin-api/node'
import { ACCOUNT_SERVICE } from '@acorn/plugin-account/contract/service.ts'
import { AGENTS_SESSION_EXECUTE, type AgentSessionExecute } from '@acorn/plugin-agents/contract/sessionExecute.ts'
import { AGENTS_DEFAULT_PROFILE } from '@acorn/plugin-agents/contract/defaultProfile.ts'
import {
  AGENTS_REQUESTS,
  AGENTS_REVIEW_INPUT,
  AGENTS_TURNS,
  type AgentLifecycleFrame,
} from '@acorn/plugin-agents/contract/lifecycle.ts'
import { AGENTS_REQUEST_ANSWER, type AgentRequestAnswer } from '@acorn/plugin-agents/contract/requestAnswer.ts'
import { slackApprovals } from './approvals'
import { slackGateway } from './gateway'
import { slackInbound } from './inbound'
import { slackRuntime, type SlackDeps } from './runtime'
import { settingsRoutes } from './settings'
import { slackStore } from './store'
import { slackTurns } from './turns'

type Context = Parameters<NonNullable<NodePlugin['init']>>[0]

// The Slack plugin, built on first use (../node/index.ts). Everything here waits for a link a paired
// device confirmed in Settings → Slack: until then, a delivery is answered and dropped, and an agents
// event is ignored. A delivery never records a link.

/** A capability's copy for this plugin, the way the host binds one for a loaded plugin. */
const bound = <T>(value: T | undefined): T | null =>
  value ? ((value as Record<symbol, (caller: string) => T>)[BIND_CAPABILITY_CALLER]?.('slack') ?? null) : null

export async function startSlack(ctx: Context) {
  const store = slackStore(ctx.storage.open())
  const service = ctx.capabilities.require(ACCOUNT_SERVICE)
  const gateway = slackGateway(service)
  const deps: SlackDeps = {
    store,
    gateway,
    site: await service.url('/'),
    execute: bound<AgentSessionExecute>(ctx.capabilities.get(AGENTS_SESSION_EXECUTE)),
    defaultProfileId: () => ctx.capabilities.get(AGENTS_DEFAULT_PROFILE)?.id,
    turns: ctx.capabilities.get(AGENTS_TURNS) ?? null,
    reviewInput: ctx.capabilities.get(AGENTS_REVIEW_INPUT) ?? null,
    requests: ctx.capabilities.get(AGENTS_REQUESTS) ?? null,
    requestAnswer: bound<AgentRequestAnswer>(ctx.capabilities.get(AGENTS_REQUEST_ANSWER)),
    tasks: {
      createRoot: (projectId, seed, id) => ctx.core.tasks.createRoot(projectId, seed, id),
      isActive: async (taskId) => (await ctx.core.tasks.active()).some((task) => task.id === taskId),
      folder: (taskId) => ctx.core.tasks.root(taskId).catch(() => null),
    },
    projects: async () => {
      const folders = await ctx.core.projects.checkouts()
      const refs = await Promise.all(folders.map(({ id }) => ctx.core.projects.byId(id)))
      return refs.flatMap((ref) => (ref ? [{ id: ref.id, name: ref.name }] : []))
    },
    // A known key's value can't be cut out by position, so text holding one doesn't leave at all.
    safeText: async (text, folder) => {
      const matcher = await ctx.core.knownValues?.matcher(folder)
      const keys = matcher?.lookup(text).matches ?? []
      if (keys.length)
        return `_This held a key from this computer (${[...new Set(keys.map((key) => key.name))].join(', ')}), so it isn't posted here. Read it in Acorn._`
      return redactSecretText(text)
    },
    now: Date.now,
    warn: (message) => ctx.log.warn(message),
  }
  const rt = slackRuntime(deps)
  const turns = slackTurns(rt)
  const approvals = slackApprovals(rt, turns)
  const inbound = slackInbound(rt, turns, approvals.click)
  let linked = await store.hasLinks()
  let recovered = false

  // The first event after a start also posts what turns that settled while the Node was down owe.
  const whenLinked = (work: () => Promise<unknown>): void => {
    if (!linked) return
    if (!recovered) {
      recovered = true
      void rt.serial(() => turns.recover())
    }
    void rt.serial(work)
  }

  return {
    /** `POST /v1/gateway/slack/events`. Answered at once; the work follows in order. */
    async gateway(request: Request): Promise<Response> {
      if (request.method !== 'POST' || new URL(request.url).pathname !== '/events')
        return new Response(null, { status: 404 })
      const delivery = slackDeliverySchema.safeParse(await request.json().catch(() => null))
      if (!delivery.success) return Response.json({ error: 'bad_request' }, { status: 400 })
      whenLinked(() => inbound.receive(delivery.data))
      return Response.json({ ok: true })
    },
    settings: settingsRoutes({
      store,
      gateway,
      service,
      onLinksChanged: async () => void (linked = await store.hasLinks()),
    }),
    event(frame: AgentLifecycleFrame | { channel: 'tasks:changed'; taskId: string | null }): void {
      switch (frame.channel) {
        case 'plugin:agents:turn-changed':
          return whenLinked(() => turns.turnChanged(frame))
        case 'plugin:agents:activity':
          return whenLinked(() => turns.activity(frame))
        case 'plugin:agents:request-changed':
          return whenLinked(() => approvals.requestChanged(frame))
        case 'plugin:agents:sessions-changed':
          if (frame.archived) whenLinked(() => inbound.sessionArchived(frame.sessionId))
          return
        case 'tasks:changed':
          if (frame.taskId) whenLinked(() => inbound.taskChanged(frame.taskId!))
          return
      }
    },
    purge: (taskIds: string[]) => store.purgeTasks(taskIds),
  }
}

export type SlackPlugin = Awaited<ReturnType<typeof startSlack>>
