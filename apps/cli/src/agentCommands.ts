import type { ParsedArgs } from './args'
import { CliError } from './error'
import { operationKey, readBounded, rejectDoubleStdin, requestKey, requireOption, typedId } from './input'
import type { CliNode } from './node'
import { agentEventResource, agentSessionResource, agentTurnAck, type AgentSessionRow } from './projection'

type Provider = { id: string; profileId: string; label: string; installed: boolean; authenticated: boolean | null; driverKind: string; diagnostics: string[] }
type Turn = { id: string; sessionId: string; ordinal: number; status: string }
type Snapshot = { session: AgentSessionRow; turns: Turn[]; events: EventRow[]; requests: { status: string }[] }
type EventRow = { id: string; sessionId: string; turnId: string | null; seq: number; event: { type: string }; createdAt: number; foldedThroughSeq?: number }
type EventPage = { events: EventRow[]; nextCursor: number | null }
const base = '/v1/p/agents'
const sessionPath = (id: string) => `${base}/sessions/${encodeURIComponent(id)}`
const numberOption = (value: string | undefined, name: string, fallback: number, min: number, max: number) => {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) throw new CliError('usage', `--${name} must be an integer from ${min} to ${max}.`, 2)
  return number
}

async function prompt(options: Record<string, string>): Promise<string> {
  const direct = options.prompt
  const file = options['prompt-file']
  if (!!direct === !!file) throw new CliError('usage', 'Provide exactly one of --prompt or --prompt-file.', 2)
  const value = file ? await readBounded(file, 1_000_000) : direct!
  if (!value.trim() || value.length > 1_000_000) throw new CliError('invalid_input', 'Prompt must contain 1 to 1,000,000 characters.', 2)
  return value
}

const sessionResource = (node: CliNode, snapshot: Snapshot) => agentSessionResource(node.nodeId, snapshot.session, {
  lastTurnId: snapshot.turns.at(-1)?.id ?? null,
  lastTurnStatus: snapshot.turns.at(-1)?.status ?? null,
  pendingRequests: snapshot.requests.filter((request) => request.status === 'pending').length,
})

async function eventPage(node: CliNode, id: string, afterSeq: number, limit: number): Promise<EventPage> {
  const page = await node.get(`${sessionPath(id)}/events?afterSeq=${afterSeq}&limit=${limit}`) as EventPage
  if (!Array.isArray(page?.events)) throw new CliError('invalid_response', 'The Agents plugin returned an invalid event page.', 1)
  return page
}

async function events(node: CliNode, args: ParsedArgs, id: string): Promise<unknown> {
  let cursor = numberOption(args.options['after-seq'], 'after-seq', 0, 0, Number.MAX_SAFE_INTEGER)
  const limit = numberOption(args.options.limit, 'limit', 500, 1, 2000)
  const follow = args.options.follow === 'true'
  const stream = follow || args.output === 'jsonl'
  const collected: unknown[] = []
  let stopped = false
  const stop = () => { stopped = true }
  if (follow) process.on('SIGINT', stop)
  try {
    do {
      let page: EventPage
      try { page = await eventPage(node, id, cursor, limit) }
      catch (error) {
        if (!follow || !(error instanceof CliError) || error.code !== 'node_unreachable') throw error
        await (node.waitForHint?.(id, 5000) ?? new Promise((resolve) => setTimeout(resolve, 5000)))
        continue
      }
      for (const row of page.events) {
        if (row.seq <= cursor) continue
        if (row.seq > cursor + 1) process.stderr.write(`acorn: Durable agent events skip from sequence ${cursor} to ${row.seq}.\n`)
        const resource = agentEventResource(node.nodeId, row)
        if (stream) process.stdout.write(`${JSON.stringify(resource)}\n`)
        else collected.push(resource)
        cursor = Math.max(cursor, row.foldedThroughSeq ?? row.seq)
      }
      if (page.nextCursor !== null && page.nextCursor > cursor) { cursor = page.nextCursor; continue }
      if (page.events.length >= limit && page.events.length > 0) continue
      if (!follow || stopped) break
      await (node.waitForHint?.(id, 5000) ?? new Promise((resolve) => setTimeout(resolve, 5000)))
    } while (!stopped)
  } finally { if (follow) process.off('SIGINT', stop) }
  return stream ? undefined : collected
}

function waitMet(snapshot: Snapshot, until: string): boolean {
  if (until === 'ready') return snapshot.session.runtimeState === 'ready'
  if (until === 'attention') return !['none', 'unread'].includes(snapshot.session.attention)
  if (until === 'stopped') return ['stopped', 'failed', 'archived'].includes(snapshot.session.runtimeState)
  return !!snapshot.turns.at(-1) && ['completed', 'failed', 'cancelled', 'interrupted'].includes(snapshot.turns.at(-1)!.status)
}

async function wait(node: CliNode, args: ParsedArgs, id: string): Promise<unknown> {
  const until = args.options.until ?? 'turn-completed'
  const routeUntil = until.replace('-', '_')
  const timeoutSeconds = numberOption(args.options.timeout, 'timeout', 300, 0, 86400)
  const deadline = Date.now() + timeoutSeconds * 1000
  let snapshot = await node.get(sessionPath(id)) as Snapshot
  if (waitMet(snapshot, until)) return checkedResult(node, args, id, until, snapshot)
  const afterSeq = until === 'turn-completed' ? snapshot.session.lastEventSeq : 0
  while (true) {
    const remaining = Math.max(0, deadline - Date.now())
    snapshot = await node.get(`${sessionPath(id)}/wait?afterSeq=${afterSeq}&until=${routeUntil}&timeoutMs=${Math.min(remaining, 30000)}`) as Snapshot
    if (waitMet(snapshot, until)) break
    if (remaining === 0 || Date.now() >= deadline) {
      const resource = sessionResource(node, snapshot)
      throw new CliError('wait_timeout', `Agent session ${id} did not reach ${until} within ${timeoutSeconds} seconds.`, 5, undefined, true, resource)
    }
  }
  return checkedResult(node, args, id, until, snapshot)
}

function checkedResult(node: CliNode, args: ParsedArgs, id: string, until: string, snapshot: Snapshot): unknown {
  const resource = sessionResource(node, snapshot)
  if (args.options.check === 'true' && (snapshot.session.runtimeState === 'failed'
    || ['failed', 'cancelled', 'interrupted'].includes(snapshot.turns.at(-1)?.status ?? ''))) {
    throw new CliError('agent_failed', `Agent session ${id} reached ${until} with a failed or canceled turn.`, 6, undefined, false, resource)
  }
  return resource
}

export async function runAgentCommand(node: CliNode, args: ParsedArgs): Promise<unknown> {
  const [, verb, rawId] = args.positionals
  const o = args.options
  if (verb === 'providers') {
    const providers = await node.get(`${base}/providers`) as Provider[]
    if (!Array.isArray(providers)) throw new CliError('invalid_response', 'The Agents plugin returned an invalid provider roster.', 1)
    return providers.map((provider) => ({ apiVersion: 'acorn.cli/v1', kind: 'AgentProvider', nodeId: node.nodeId,
      id: provider.id, profileId: provider.profileId, label: provider.label, installed: provider.installed,
      authenticated: provider.authenticated, driverKind: provider.driverKind, diagnostics: provider.diagnostics }))
  }
  if (verb === 'list') {
    rejectDoubleStdin([o.task, o.workspace])
    const taskId = o.task ? await typedId(o.task, 'Task', node, 'task') : undefined
    const workspaceId = o.workspace ? await typedId(o.workspace, 'Workspace', node, 'workspace') : undefined
    const query = new URLSearchParams({ ...(taskId ? { taskId } : {}), ...(workspaceId ? { workspaceId } : {}), limit: String(numberOption(o.limit, 'limit', 100, 1, 100)) })
    const rows = await node.get(`${base}/sessions?${query}`) as { sessions: AgentSessionRow[]; nextCursor: string | null }
    if (!Array.isArray(rows?.sessions)) throw new CliError('invalid_response', 'The Agents plugin returned an invalid session list.', 1)
    const all = [...rows.sessions]
    let cursor = rows.nextCursor
    while (cursor) {
      const page = await node.get(`${base}/sessions?${query}&cursor=${encodeURIComponent(cursor)}`) as { sessions: AgentSessionRow[]; nextCursor: string | null }
      if (!Array.isArray(page?.sessions)) throw new CliError('invalid_response', 'The Agents plugin returned an invalid session page.', 1)
      all.push(...page.sessions)
      cursor = page.nextCursor
    }
    return all.map((row) => agentSessionResource(node.nodeId, row))
  }
  if (verb === 'start') {
    rejectDoubleStdin([o.task, o['prompt-file']])
    const taskId = await typedId(o.task, 'Task', node, 'task')
    const text = await prompt(o)
    const providers = await node.get(`${base}/providers`) as Provider[]
    const profileId = requireOption(o, 'profile')
    const candidates = providers.filter((provider) => provider.profileId === profileId && (!o.provider || provider.id === o.provider))
    if (candidates.length !== 1) throw new CliError('invalid_profile', `Profile ${profileId} has ${candidates.length} matching providers. Select an available provider with --provider.`, 4)
    const provider = candidates[0]!
    if (!provider.installed || provider.authenticated === false) throw new CliError('provider_unavailable', `${provider.label} is unavailable: ${provider.diagnostics.join('; ')}`, 4)
    const existing = await node.get(`${base}/sessions?taskId=${encodeURIComponent(taskId)}&archived=false&limit=1`) as { sessions: AgentSessionRow[] }
    if (!Array.isArray(existing?.sessions)) throw new CliError('invalid_response', 'The Agents plugin returned an invalid session list.', 1)
    if (existing.sessions.length) process.stderr.write('acorn: This task already has a managed session; sessions may share its worktree.\n')
    const requestId = requestKey(o['request-id'])
    const session = await node.mutate('POST', `${base}/sessions`, { taskId, providerId: provider.id, profileId, kind: 'interactive', config: {} }, operationKey(requestId, 'agent-session')) as AgentSessionRow
    try {
      const turn = await node.mutate('POST', `${sessionPath(session.id)}/turns`, { input: [{ type: 'text', text }], source: 'interactive', effectivePolicy: {} }, operationKey(requestId, 'agent-first-turn')) as Turn
      return agentSessionResource(node.nodeId, session, { firstTurnId: turn.id, firstTurnStatus: turn.status })
    } catch (error) {
      throw new CliError('partial_agent_start', `Session ${session.id} was created, but its first turn was not confirmed. Retry with --request-id ${requestId} to enqueue the same turn. ${error instanceof Error ? error.message : String(error)}`, 7, requestId, true,
        agentSessionResource(node.nodeId, session, { firstTurnId: null, firstTurnStatus: 'unconfirmed' }))
    }
  }
  if (verb === 'send') rejectDoubleStdin([rawId ?? o.session, o['prompt-file']])
  const id = await typedId(rawId ?? o.session, 'AgentSession', node, 'session')
  if (verb === 'show') return sessionResource(node, await node.get(sessionPath(id)) as Snapshot)
  if (verb === 'send') {
    const text = await prompt(o)
    const turn = await node.mutate('POST', `${sessionPath(id)}/turns`, { input: [{ type: 'text', text }], source: 'interactive', effectivePolicy: {} }, requestKey(o['request-id'])) as Turn
    return agentTurnAck(node.nodeId, turn)
  }
  if (verb === 'events') return events(node, args, id)
  if (verb === 'wait') return wait(node, args, id)
  throw new CliError('usage', 'Unknown agent command.', 2)
}
