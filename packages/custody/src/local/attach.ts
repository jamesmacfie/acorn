import { readFileSync } from 'node:fs'
import { Agent as HttpsAgent } from 'node:https'
import { join } from 'node:path'
import { lockedBy } from '@acorn/node-core/server/storage/dataRoot.ts'
import { certificateFingerprint } from '@acorn/node-core/server/transport/tls.ts'
import { nodeIdentitySchema, nodeInfoSchema } from '@acorn/protocol/node.ts'
import { pinnedTlsOptions } from '../broker/nodeBroker'
import { nodeRequest } from '../broker/nodeRequest'
import { LOCAL_TOKEN_SCOPE, type DeviceTokens } from '../custody/deviceTokenStore'

export type RunningNode = { pid: number; nodeId: string; endpoint: string; fingerprint: string; certPem: string }

export function knownNodeId(dataDir: string): string | null {
  try {
    const identity = nodeIdentitySchema.safeParse(JSON.parse(readFileSync(join(dataDir, 'node.json'), 'utf8')))
    return identity.success ? identity.data.nodeId : null
  } catch {
    return null
  }
}

export function runningNode(dataDir: string): RunningNode | null {
  const pid = lockedBy(dataDir)
  if (pid === null) return null
  const identity = nodeIdentitySchema.safeParse(JSON.parse(readFileSync(join(dataDir, 'node.json'), 'utf8')))
  if (!identity.success || !identity.data.port)
    throw new Error(`A node holds ${dataDir} (pid ${pid}) but its node.json names no port. Stop it and try again.`)
  const certPem = readFileSync(join(dataDir, 'tls', 'cert.pem'), 'utf8')
  return {
    pid,
    nodeId: identity.data.nodeId,
    endpoint: `https://127.0.0.1:${identity.data.port}`,
    fingerprint: certificateFingerprint(certPem),
    certPem,
  }
}

const LOCAL_REQUEST_TIMEOUT_MS = 5_000

/** The saved token for the Node on this computer, or nothing when that Node refuses it.
 *
 *  A token can outlive its device row: the owner can revoke it, and a reset data root drops every
 *  row. Without this check, the client attaches with a dead token and stops at "revoked" instead of
 *  asking to pair. `/v1/node` includes the Node's ID only for a token it accepts, so a reply without
 *  one is a refusal, and the token is forgotten. Any other failure keeps the token, because a slow
 *  Node is no reason to throw away a working one. */
export async function usableLocalToken(running: RunningNode, tokens: DeviceTokens): Promise<string | undefined> {
  const token = tokens.read(LOCAL_TOKEN_SCOPE)
  if (!token) return undefined
  const agent = new HttpsAgent(pinnedTlsOptions(running.fingerprint, running.certPem))
  try {
    const response = await nodeRequest({
      url: new URL('/v1/node', running.endpoint),
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      agent,
      signal: AbortSignal.timeout(LOCAL_REQUEST_TIMEOUT_MS),
      maxResponseBytes: 16 * 1024,
    })
    if (response.status !== 200) return token
    const info = nodeInfoSchema.safeParse(JSON.parse(new TextDecoder().decode(response.body)))
    if (!info.success || info.data.nodeId) return token
    tokens.forget(LOCAL_TOKEN_SCOPE)
    return undefined
  } catch {
    return token
  } finally {
    agent.destroy()
  }
}

/** Asks a Node on this computer to drain and exit over `POST /v1/core/node/stop`. With `restart`, it
 *  exits with NODE_RESTART_EXIT_CODE so a foreground launcher starts it again. False when the Node
 *  didn't take the request, so the caller can fall back to a signal. */
export async function requestNodeStop(
  node: Pick<RunningNode, 'endpoint' | 'fingerprint' | 'certPem'>,
  token: string,
  restart = false,
): Promise<boolean> {
  const agent = new HttpsAgent(pinnedTlsOptions(node.fingerprint, node.certPem))
  try {
    const response = await nodeRequest({
      url: new URL('/v1/core/node/stop', node.endpoint),
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: { kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify({ restart })) },
      agent,
      signal: AbortSignal.timeout(LOCAL_REQUEST_TIMEOUT_MS),
      maxResponseBytes: 16 * 1024,
    })
    return response.status === 202
  } catch {
    return false
  } finally {
    agent.destroy()
  }
}
