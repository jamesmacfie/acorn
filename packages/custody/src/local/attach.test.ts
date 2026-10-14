import { createServer as createHttpsServer, type Server } from 'node:https'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureCert } from '@acorn/node-core/server/transport'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { LOCAL_TOKEN_SCOPE } from '../custody/deviceTokenStore'
import { usableLocalToken, type RunningNode } from './attach'
import { custody } from './public'

const ACCEPTED = 'acorn_dt_accepted'
let directory: string
let cert: ReturnType<typeof ensureCert>
let server: Server
let running: RunningNode

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'acorn-local-token-'))
  cert = ensureCert(directory)
  // Like the Node's /v1/node: the ID only for a token it accepts.
  server = createHttpsServer({ key: cert.keyPem, cert: cert.certPem }, (req, res) => {
    const accepted = req.headers.authorization === `Bearer ${ACCEPTED}`
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        baseline: ACORN_BASELINE,
        protocolVersion: NODE_PROTOCOL_VERSION,
        fingerprint: cert.fingerprint,
        ...(accepted ? { nodeId: 'node-1' } : {}),
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `https://127.0.0.1:${(server.address() as AddressInfo).port}`
  running = { pid: 1, nodeId: 'node-1', endpoint, fingerprint: cert.fingerprint, certPem: cert.certPem }
})

afterEach(() => rmSync(join(directory, 'custody'), { recursive: true, force: true }))

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(directory, { recursive: true, force: true })
})

const saved = (token: string) => {
  const { tokens } = custody(join(directory, 'custody'))
  tokens.write(LOCAL_TOKEN_SCOPE, token)
  return tokens
}

it('keeps a token the Node accepts', async () => {
  const tokens = saved(ACCEPTED)
  expect(await usableLocalToken(running, tokens)).toBe(ACCEPTED)
  expect(tokens.read(LOCAL_TOKEN_SCOPE)).toBe(ACCEPTED)
})

it('forgets a token the Node refuses', async () => {
  const tokens = saved('acorn_dt_revoked')
  expect(await usableLocalToken(running, tokens)).toBeUndefined()
  expect(tokens.read(LOCAL_TOKEN_SCOPE)).toBeUndefined()
})

it('keeps the token when the Node cannot be reached', async () => {
  const tokens = saved('acorn_dt_revoked')
  const gone = { ...running, endpoint: 'https://127.0.0.1:1' }
  expect(await usableLocalToken(gone, tokens)).toBe('acorn_dt_revoked')
  expect(tokens.read(LOCAL_TOKEN_SCOPE)).toBe('acorn_dt_revoked')
})
