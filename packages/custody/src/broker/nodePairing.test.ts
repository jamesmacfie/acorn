import { createServer as createHttpsServer, type Server } from 'node:https'
import type { RequestListener } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureCert } from '@acorn/node-core/server/transport'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { NodeResponseTooLargeError } from './nodeRequest'
import { MAX_NODE_PROBE_BYTES, pairWithNode, probeNode } from './nodePairing'

let directory: string
let cert: ReturnType<typeof ensureCert>
const servers: Server[] = []

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'acorn-pair-limit-'))
  cert = ensureCert(directory)
})

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

afterAll(() => rmSync(directory, { recursive: true, force: true }))

async function start(handler: RequestListener): Promise<string> {
  const server = createHttpsServer({ key: cert.keyPem, cert: cert.certPem }, handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `https://127.0.0.1:${(server.address() as AddressInfo).port}`
}

it('limits the unverified probe before parsing a declared oversized body', async () => {
  const endpoint = await start((_req, res) => {
    res.writeHead(200, { 'content-length': String(MAX_NODE_PROBE_BYTES + 1) })
    res.flushHeaders()
  })
  await expect(probeNode(endpoint)).rejects.toBeInstanceOf(NodeResponseTooLargeError)
})

it('limits the pinned pairing response while its chunks arrive', async () => {
  const endpoint = await start((_req, res) => {
    res.write('x'.repeat(32 * 1024))
    res.end('x'.repeat(32 * 1024 + 1))
  })
  await expect(pairWithNode({
    endpoint,
    fingerprint: cert.fingerprint,
    certPem: cert.certPem,
    baseline: ACORN_BASELINE,
  }, { code: 'unused', deviceName: 'test' })).rejects.toBeInstanceOf(NodeResponseTooLargeError)
})
