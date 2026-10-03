import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
import { Agent } from 'node:https'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { nodeRequest } from './nodeRequest'
import { normalizeFingerprint, pinnedTlsOptions } from './nodeBroker'

export type TaskConnection = { nodeId: string; taskId: string; endpoint: string; get(path: string, signal?: AbortSignal): Promise<unknown>; close(): void }
/** Task launch custody uses only its signed internal token and public TLS identity. */
export async function openTaskConnection(env: NodeJS.ProcessEnv, target?: string): Promise<TaskConnection> {
  const taskId = env.ACORN_TASK_ID
  const token = env.ACORN_API_TOKEN
  if (!taskId || !token || !env.NODE_EXTRA_CA_CERTS) throw new Error('Incomplete task launch credentials or TLS identity.')
  // The server verifies the signature. This local check rejects incompatible launch arguments before sending a credential.
  let claims: { s?: unknown; t?: unknown }
  try { claims = JSON.parse(Buffer.from(token.replace(/^acorn_it_/, '').split('.')[0]!, 'base64url').toString('utf8')) }
  catch { throw new Error('Invalid task launch credential.') }
  if (!token.startsWith('acorn_it_') || claims.s !== 'task' || claims.t !== taskId) throw new Error('Task launch identity does not match its task credential.')
  const certPem = readFileSync(env.NODE_EXTRA_CA_CERTS, 'utf8')
  const fingerprint = normalizeFingerprint(new X509Certificate(certPem).fingerprint256)
  const identity = env.ACORN_DATA_DIR ? JSON.parse(readFileSync(join(env.ACORN_DATA_DIR, 'node.json'), 'utf8')) as { nodeId?: string; port?: number } : null
  const nodeId = env.ACORN_NODE_ID ?? identity?.nodeId
  if (!nodeId || identity?.nodeId && identity.nodeId !== nodeId) throw new Error('Task launch Node identity is missing or changed.')
  const endpoint = identity?.port ? `https://127.0.0.1:${identity.port}` : env.ACORN_API_URL
  if (!endpoint) throw new Error('Task launch Node endpoint is missing.')
  const origin = new URL(endpoint)
  if (origin.protocol !== 'https:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
    || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Task launch endpoint must be loopback HTTPS.')
  if (target && target !== nodeId && target.replace(/\/$/, '') !== endpoint.replace(/\/$/, '')) throw new Error('--node conflicts with the task launch Node.')
  const agent = new Agent(pinnedTlsOptions(fingerprint, certPem))
  const closed = new AbortController()
  const request = async (path: string, signal?: AbortSignal, probe = false): Promise<unknown> => {
    if (!probe && (!path.startsWith(`/v1/core/tasks/${encodeURIComponent(taskId)}/scripts`) || !/^\/v1\/core\/tasks\/[^/]+\/scripts(?:\/(?:wait|logs))?(?:\?[^#]*)?$/.test(path))) throw new Error('Task CLI connection permits only its own task script reads.')
    const response = await nodeRequest({ url: new URL(path, origin), method: 'GET', agent,
      headers: probe ? {} : { 'x-acorn-internal': token }, signal: AbortSignal.any([closed.signal, AbortSignal.timeout(35_000), ...(signal ? [signal] : [])]), maxResponseBytes: 256 * 1024 })
    const value = JSON.parse(new TextDecoder().decode(response.body)) as { error?: { code?: string; message?: string } }
    if (response.status >= 400) throw Object.assign(new Error(value.error?.message ?? `Node returned HTTP ${response.status}.`), { code: value.error?.code, status: response.status })
    return value
  }
  try {
    const info = await request('/v1/node', undefined, true) as { nodeId?: string; fingerprint?: string; protocolVersion?: number; baseline?: string }
    if (info.nodeId !== nodeId || normalizeFingerprint(info.fingerprint ?? '') !== fingerprint) throw new Error('Task launch Node identity changed.')
    if (info.protocolVersion !== NODE_PROTOCOL_VERSION || info.baseline !== ACORN_BASELINE) throw new Error('Task launch Node protocol is incompatible.')
    return { nodeId, taskId, endpoint, get: request, close() { closed.abort(); agent.destroy() } }
  } catch (error) { agent.destroy(); throw error }
}
