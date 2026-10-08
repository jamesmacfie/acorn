import { createServer, type Server } from 'node:https'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { ensureCert } from '@acorn/node-core/server/transport'
import { mintInternalToken } from '@acorn/node-core/server/auth'
import { credentialFileFromEnv } from '@acorn/node-core/server/auth/credentialFile.ts'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import { openTaskConnection } from './taskConnection'

let dir: string
let cert: ReturnType<typeof ensureCert>
const servers: Server[] = []
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'acorn-task-cli-')); cert = ensureCert(dir) })
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } })
afterAll(() => rmSync(dir, { recursive: true, force: true }))
async function launch(nodeId = 'node') {
  const seen: string[] = []
  let token = mintInternalToken('test-signing-key', { scope: 'task', taskId: 'task' })
  const server = createServer({ key: cert.keyPem, cert: cert.certPem }, (req, res) => {
    seen.push(req.url!)
    if (req.url === '/v1/node') { res.end(JSON.stringify({ nodeId, fingerprint: cert.fingerprint, baseline: ACORN_BASELINE, protocolVersion: NODE_PROTOCOL_VERSION })); return }
    const valid = req.headers['x-acorn-internal'] === token
    expect(req.headers.authorization).toBeUndefined()
    if (!valid) { res.writeHead(401); res.end('{}'); return }
    res.end(JSON.stringify({ taskId: 'task' }))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  writeFileSync(join(dir, 'node.json'), JSON.stringify({ nodeId: 'node', port }))
  return { seen, updateToken(value: string) { token = value }, env: { ACORN_TASK_ID: 'task', ACORN_NODE_ID: 'node', ACORN_DATA_DIR: dir,
    NODE_EXTRA_CA_CERTS: join(dir, 'tls/cert.pem'), ACORN_API_TOKEN: token } }
}
it('reads the renewed task credential on later requests', async () => {
  const fixture = await launch()
  const tokenFile = join(dir, 'task-token')
  writeFileSync(tokenFile, fixture.env.ACORN_API_TOKEN)
  const connection = await openTaskConnection({ ...fixture.env, ACORN_API_TOKEN_FILE: tokenFile })
  try {
    await connection.get('/v1/core/tasks/task/scripts')
    await new Promise(resolve => setTimeout(resolve, 5))
    const renewed = mintInternalToken('test-signing-key', { scope: 'task', taskId: 'task' })
    fixture.updateToken(renewed)
    writeFileSync(tokenFile, renewed)
    expect(await connection.get('/v1/core/tasks/task/scripts')).toEqual({ taskId: 'task' })
    rmSync(tokenFile)
    await expect(connection.get('/v1/core/tasks/task/scripts')).rejects.toThrow('credential file is unavailable')
  } finally { connection.close() }
})
it('finds the refreshed file from a migrated task shell without a file variable', async () => {
  const fixture = await launch()
  const env = { ...fixture.env, ACORN_SESSION_ID: 'old-session' }
  const path = credentialFileFromEnv(env)!
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, fixture.env.ACORN_API_TOKEN)
  const connection = await openTaskConnection(env)
  try { expect(await connection.get('/v1/core/tasks/task/scripts')).toEqual({ taskId: 'task' }) }
  finally { connection.close() }
})
it('uses only pinned task credentials and rejects incompatible Node, task, and route identities', async () => {
  const fixture = await launch()
  const connection = await openTaskConnection(fixture.env)
  try {
    expect(await connection.get('/v1/core/tasks/task/scripts')).toEqual({ taskId: 'task' })
    await expect(connection.get('/v1/core/tasks/foreign/scripts')).rejects.toThrow('only its own')
    await expect(connection.get('/v1/core/tasks/task/scripts/../../../devices')).rejects.toThrow('only its own')
    await expect(openTaskConnection(fixture.env, 'other-node')).rejects.toThrow('conflicts')
    await expect(openTaskConnection({ ...fixture.env, ACORN_TASK_ID: 'foreign' })).rejects.toThrow('does not match')
    await expect(openTaskConnection({ ...fixture.env, ACORN_API_TOKEN: mintInternalToken('test-signing-key', { scope: 'service' }) })).rejects.toThrow('does not match')
    expect(fixture.seen).toEqual(['/v1/node', '/v1/core/tasks/task/scripts'])
  } finally { connection.close() }
})
it('refuses a changed Node identity and a different certificate without falling back', async () => {
  const fixture = await launch('changed-node')
  await expect(openTaskConnection(fixture.env)).rejects.toThrow('identity changed')
  const otherDir = mkdtempSync(join(tmpdir(), 'acorn-task-other-cert-'))
  try {
    ensureCert(otherDir)
    await expect(openTaskConnection({ ...fixture.env, NODE_EXTRA_CA_CERTS: join(otherDir, 'tls/cert.pem') })).rejects.toThrow()
    await expect(openTaskConnection({ ...fixture.env, ACORN_API_TOKEN: '' })).rejects.toThrow('Incomplete')
  } finally { rmSync(otherDir, { recursive: true, force: true }) }
})
