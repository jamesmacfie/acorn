import { randomUUID } from 'node:crypto'
import { FleetStore, NodeBroker, type FleetNode } from '@acorn/custody/broker'
import { probeNode } from '@acorn/custody/broker/nodePairing.ts'
import { AmbiguousNodeError, custody, dataRootDir, pairInteractively, rememberedNode, runningNode } from '@acorn/custody/local'
import { LOCAL_TOKEN_SCOPE } from '@acorn/custody/custody/deviceTokenStore.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import type { NodeFetchResponse, NodeStatus } from '@acorn/protocol/broker.ts'
import { CliError } from './error'

export type CliNode = {
  nodeId: string
  endpoint: string
  get(path: string): Promise<unknown>
  mutate(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body: unknown, key: string): Promise<unknown>
  waitForHint?(sessionId: string, timeoutMs: number): Promise<void>
  close(): void
}

export function probeFailure(error: unknown): CliError {
  const message = error instanceof Error ? error.message : String(error)
  if (/baseline|protocol/.test(message)) return new CliError('protocol_mismatch', message, 3)
  if (/certificate|fingerprint|intercept/.test(message)) return new CliError('identity_mismatch', message, 3)
  return new CliError('node_unreachable', message, 3)
}

export function matchingNode(fleet: FleetStore, target: string): FleetNode | undefined {
  try { return rememberedNode(fleet, target) }
  catch (error) {
    if (error instanceof AmbiguousNodeError) throw new CliError('ambiguous_node', error.message, 2)
    throw error
  }
}

const localPairingInstructions = (pid: number): string =>
  `If desktop started the local Node, open Settings > Nodes > Pair another client. ` +
  `If it is standalone, run kill -USR1 ${pid} and read its terminal output.`

export async function openCliNode(target?: string): Promise<CliNode> {
  const { tokens, fleet } = custody()
  let selected: FleetNode
  if (target) {
    const remembered = matchingNode(fleet, target)
    if (remembered) selected = remembered
    else if (target.startsWith('https://')) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new CliError('pairing_required', `Pair ${target} in an interactive terminal first.`, 3)
      selected = await pairInteractively(target, fleet, { label: new URL(target).host, local: false })
    } else throw new CliError('unknown_node', `No remembered Node matches ${target}.`, 3)
  } else {
    const running = runningNode(dataRootDir())
    if (!running) throw new CliError('node_absent', 'No Node is running for this data root. Start one with the desktop or standalone entry.', 3)
    const prior = fleet.get(running.nodeId)
    if (prior?.fingerprint && prior.fingerprint !== running.fingerprint) throw new CliError('identity_mismatch', 'The local Node certificate changed; pairing is required.', 3)
    const token = tokens.read(LOCAL_TOKEN_SCOPE)
    if (!token) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new CliError('pairing_required', `${localPairingInstructions(running.pid)} Then run acorn workspace list in a terminal.`, 3)
      }
      process.stderr.write(`${localPairingInstructions(running.pid)}\n`)
      selected = await pairInteractively(running.endpoint, fleet, { label: prior?.label ?? 'This computer', local: true })
    } else {
      const { pid: _pid, ...record } = running
      selected = fleet.remember({ ...record, label: prior?.label ?? 'This computer', local: true }, token)
    }
  }

  const token = fleet.tokenFor(selected.nodeId)
  if (!token) throw new CliError('pairing_required', `Node ${selected.nodeId} has no device token. Pair it in an interactive terminal.`, 3)
  if (!selected.fingerprint || !selected.certPem) throw new CliError('identity_missing', 'The remembered Node has no certificate pin. Pair it again.', 3)
  let probe: Awaited<ReturnType<typeof probeNode>>
  try { probe = await probeNode(selected.endpoint) }
  catch (error) { throw probeFailure(error) }
  if (probe.fingerprint !== selected.fingerprint) throw new CliError('identity_mismatch', `Node ${selected.nodeId} presented a different certificate.`, 3)
  if (!probe.compatible || probe.protocolVersion !== NODE_PROTOCOL_VERSION) throw new CliError('protocol_mismatch', `Node ${selected.nodeId} speaks an incompatible protocol.`, 3)

  let latest: NodeStatus | undefined
  const hints = new Set<{ sessionId: string; resolve: () => void }>()
  const wake = (sessionId?: string) => { for (const hint of hints) if (!sessionId || hint.sessionId === sessionId) hint.resolve() }
  const broker = new NodeBroker({
    frame(_nodeId, frame) {
      const value = frame as { channel?: string; sessionId?: string; session?: { id?: string }; event?: { sessionId?: string }; turn?: { sessionId?: string } }
      if (value.channel?.startsWith('agent:')) wake(value.sessionId ?? value.session?.id ?? value.event?.sessionId ?? value.turn?.sessionId)
      if (value.channel === 'ws:shed') wake()
    },
    bytes() {}, status(status) { latest = status; if (status.state === 'online') wake() },
  })
  broker.upsert({ ...selected, token })
  const request = async (method: string, path: string, body?: unknown, key?: string): Promise<unknown> => {
      if (latest?.state === 'incompatible') throw new CliError('protocol_mismatch', 'The Node protocol is incompatible.', 3)
      if (latest?.error?.code === 'identity_mismatch') throw new CliError('identity_mismatch', 'The Node certificate changed.', 3)
      let response: NodeFetchResponse
      try {
        response = await broker.fetch(selected.nodeId, {
          requestId: randomUUID(), path, method,
          headers: { ...(key ? { 'idempotency-key': key } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
          ...(body !== undefined ? { body: { kind: 'bytes' as const, bytes: new TextEncoder().encode(JSON.stringify(body)) } } : {}),
        })
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'ACORN_PIN_MISMATCH') throw new CliError('identity_mismatch', 'The Node certificate changed.', 3)
        throw new CliError(method === 'GET' ? 'node_unreachable' : 'ambiguous_mutation',
          `${error instanceof Error ? error.message : String(error)}${key ? ` Request ID: ${key}. Inspect the resource before retrying.` : ''}`,
          method === 'GET' ? 3 : 7, key)
      }
      let result: unknown
      try { result = JSON.parse(new TextDecoder().decode(response.body)) }
      catch { throw new CliError('invalid_response', `Node returned invalid JSON for ${path}.`, method === 'GET' ? 1 : 7, key) }
      if (response.status >= 400) {
        const api = result as { error?: { code?: string; message?: string; requestId?: string; retryable?: boolean } }
        const error = api.error
        const exitCode = response.status === 401 || error?.code === 'protocol_mismatch' ? 3
          : response.status < 500 || error?.code === 'bridge-unavailable' ? 4 : method === 'GET' ? 1 : 7
        throw new CliError(error?.code ?? 'node_error', error?.message ?? `Node returned HTTP ${response.status}.`, exitCode, error?.requestId ?? key, error?.retryable)
      }
      return result
  }
  return {
    nodeId: selected.nodeId,
    endpoint: selected.endpoint,
    get: (path) => request('GET', path),
    mutate: (method, path, body, key) => request(method, path, body, key),
    waitForHint(sessionId, timeoutMs) {
      return new Promise<void>((resolve) => {
        const hint = { sessionId, resolve: () => { clearTimeout(timer); hints.delete(hint); resolve() } }
        const timer = setTimeout(hint.resolve, timeoutMs)
        hints.add(hint)
      })
    },
    close() { wake(); broker.dispose() },
  }
}
