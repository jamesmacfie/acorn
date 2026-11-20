import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { seedTlsCert } from '../../../testkit/tls.ts'
import { ensureCert } from '../tls'
import { PreviewGrants } from './grants'
import { createPreviewServer } from './previewServer'

// What answers on preview names. A loopback certificate stands in for the real one, and a TCP listener
// stands in for the relay's preview streams.

const cleanup: (() => unknown)[] = []
afterEach(async () => {
  for (const undo of cleanup.splice(0).reverse()) await undo()
})

const listening = (server: { once(event: 'listening', listener: () => void): unknown }) =>
  new Promise<void>((resolve) => server.once('listening', resolve))

it('closes the live reload sockets of a revoked device’s previews, and no one else’s', async () => {
  const dev = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await listening(dev)
  cleanup.push(() => new Promise((resolve) => dev.close(resolve)))
  const devPort = (dev.address() as AddressInfo).port

  const dir = mkdtempSync(join(tmpdir(), 'acorn-preview-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  seedTlsCert(dir)
  const { keyPem, certPem } = ensureCert(dir)
  const grants = new PreviewGrants()
  const preview = createPreviewServer({ grants, ownPort: 1 })
  preview.install({
    keyPem,
    certPem,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 3600_000),
    domain: 'preview.test',
    domainHost: 'preview.test',
    nodeLabel: 'node',
  })
  cleanup.push(() => preview.close())
  const relay = createServer((stream) => preview.serve(stream)).listen(0, '127.0.0.1')
  await listening(relay)
  cleanup.push(() => new Promise((resolve) => relay.close(resolve)))

  // A page's hot reload socket, on a preview the device opened.
  const connect = async (deviceId: string) => {
    const { id, entryKey } = grants.open({ deviceId, ancestor: undefined, port: devPort, target: async () => devPort })
    const host = `${id}.node.preview.test`
    const ws = new WebSocket(`wss://127.0.0.1:${(relay.address() as AddressInfo).port}/hmr`, {
      ca: [certPem],
      headers: {
        host,
        origin: `https://${host}`,
        cookie: `__Host-acorn-preview=${grants.spendEntryKey(id, entryKey)!.cookie}`,
      },
    })
    cleanup.push(() => ws.terminate())
    await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject))
    return ws
  }
  const phone = await connect('phone-1')
  const laptop = await connect('laptop-1')

  const closed = new Promise((resolve) => phone.once('close', resolve))
  grants.revokeDevice('phone-1')
  preview.closeUngranted()
  await closed
  expect(laptop.readyState).toBe(WebSocket.OPEN)
})
