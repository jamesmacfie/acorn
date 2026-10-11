import { createLogger, describeError } from '@acorn/plugin-api/node'
import type { AgentSessionChangedEvent } from '@acorn/protocol/nodeEvents.ts'
import type { AgentSession, AgentWsFrame } from '../../contract/wire.ts'
import type { AgentLifecycleFrame } from '../../contract/lifecycle'
import { webhookEventKind, type AgentWebhookService } from '../webhookService'
import { clientEventRecord } from './rowMapping'
import type { AgentStore } from './store'

/** Any frame the runtime sends, not only the plugin's own: the core-named `agent-session:changed`
 *  goes out through the same door (docs/plugins/events.md § Hearing a core event). */
export type PublishedFrame =
  | AgentWsFrame
  | ({ channel: 'agent-session:changed' } & AgentSessionChangedEvent)
  | AgentLifecycleFrame

type FrameListener = (frame: AgentWsFrame) => void

const log = createLogger('agents', 'agents')
const webhookLog = createLogger('agents:webhook', 'agents')

/**
 * A session row as a client keeps it, for telling whether a recorded event changed it.
 *
 * It leaves out five fields. `lastEventSeq`, `lastEventAt` and `updatedAt` move with every event, and
 * the client reads the event frame for the one of them it needs live (../../client/sessions/managedStore.ts
 * § eventSeqs). `lastEventAt` drives the sidebar's "latest activity" order, so that order re-sorts when
 * a turn starts or ends rather than on every streamed chunk. A
 * subagent's `updatedAt` is the node's clock for quieting a silent child, and moves with every tool call
 * the child makes. The task sidebar's tooltip reads it only as of the row's last broadcast. The status
 * that quieting changes is still compared. `config` is too large to compare per event, and the engine's
 * record() handles it separately.
 */
const listedRow = (session: AgentSession): string =>
  JSON.stringify({
    ...session,
    config: null,
    lastEventSeq: 0,
    lastEventAt: 0,
    updatedAt: 0,
    subagents: session.subagents.map(({ updatedAt: _heardAt, ...entry }) => entry),
  })

/**
 * Who hears a session frame: the agent socket, the Node's own listeners (waits and workflow steps),
 * the webhook queue, and the core `agent-session:changed` channel. Nothing is sent once `shutdown`
 * aborts.
 */
export class SessionFrames {
  private readonly listeners = new Set<FrameListener>()
  // The last row broadcast for each session, as `listedRow` reads it. See rowChanged().
  private readonly sentRows = new Map<string, string>()
  private readonly publications = new Set<Promise<void>>()

  constructor(
    private readonly deps: {
      publish?(frame: PublishedFrame): void
      webhooks: Pick<AgentWebhookService, 'accept'>
      store: Pick<AgentStore, 'requireSession'>
      shutdown: AbortSignal
    },
  ) {}

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Whether `session` says something its last broadcast row didn't. */
  rowChanged(session: AgentSession): boolean {
    return this.sentRows.get(session.id) !== listedRow(session)
  }

  emit(frame: AgentWsFrame): void {
    if (this.deps.shutdown.aborted) return
    // Every broadcast row counts, whoever sent it, so rowChanged() compares against what clients last
    // heard. A read mark sends its own row with `attention: none`, and the next event that puts
    // `unread` back must be sent even though the last row the engine sent also said `unread`.
    if (frame.channel === 'agent:session') this.sentRows.set(frame.session.id, listedRow(frame.session))
    else if (frame.channel === 'agent:deleted') this.sentRows.delete(frame.sessionId)
    // The socket gets the record without its search text; the Node's own listeners keep it.
    this.deps.publish?.(frame.channel === 'agent:event' ? { ...frame, event: clientEventRecord(frame.event) } : frame)
    for (const listener of this.listeners) listener(frame)
    this.track(
      this.deps.webhooks.accept(frame).catch((error) => {
        webhookLog.warn(`failed to queue delivery: ${describeError(error).message}`)
      }),
    )
    this.track(
      this.announce(frame).catch((error) => {
        log.warn(`failed to announce a session edge: ${describeError(error).message}`)
      }),
    )
  }

  /** Waits for the webhook hand-offs and announcements already started, and drops every listener. */
  async stop(): Promise<void> {
    await Promise.allSettled(this.publications)
    this.listeners.clear()
  }

  private track(work: Promise<void>): void {
    this.publications.add(work)
    const settled = () => this.publications.delete(work)
    void work.then(settled, settled)
  }

  // The webhook filter pointed inward: the same two edges, on a core channel every window and any
  // plugin's node half can hear. Third parties are otherwise blind to agent execution, since the
  // `agent:` prefix is the plugin's own.
  private async announce(frame: AgentWsFrame): Promise<void> {
    const event = webhookEventKind(frame)
    if (!event || frame.channel !== 'agent:event') return
    const session = await this.deps.store.requireSession(frame.event.sessionId)
    if (this.deps.shutdown.aborted) return
    this.deps.publish?.({ channel: 'agent-session:changed', taskId: session.taskId, sessionId: session.id, event })
  }
}
