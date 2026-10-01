import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lockedBy } from '@acorn/node-core/server/storage'
import { certificateFingerprint } from '@acorn/node-core/server/transport'
import { nodeIdentitySchema } from '@acorn/protocol/node.ts'

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
  if (!identity.success || !identity.data.port) throw new Error(`A node holds ${dataDir} (pid ${pid}) but its node.json names no port. Stop it and try again.`)
  const certPem = readFileSync(join(dataDir, 'tls', 'cert.pem'), 'utf8')
  return {
    pid,
    nodeId: identity.data.nodeId,
    endpoint: `https://127.0.0.1:${identity.data.port}`,
    fingerprint: certificateFingerprint(certPem),
    certPem,
  }
}
