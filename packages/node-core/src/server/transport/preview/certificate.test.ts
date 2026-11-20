import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountPaths, registerNodeResponseSchema } from '@acorn/protocol/account.ts'
import { previewNodeLabel } from '@acorn/protocol/relay.ts'
import { startAccountStub, type AccountStub } from '../../../testkit/accountStub'
import { startFakeAcme, type FakeAcme } from '../../../testkit/fakeAcme'
import { obtainCertificate } from './acme'
import { startCertificateManager, type CertificateManager, type PreviewCertificate } from './certificate'

// The Node getting and renewing its preview certificate, against the account stand-in and an authority that
// speaks ACME, with nothing on the internet.

const NODE_ID = 'c0ffee00-0000-4000-8000-000000000001'
let account: AccountStub
let acme: FakeAcme
let credential: string
let dir: string
let clock = Date.now()
let manager: CertificateManager | undefined
const installed: PreviewCertificate[] = []

beforeEach(async () => {
  clock = Date.now()
  installed.length = 0
  dir = mkdtempSync(join(tmpdir(), 'preview-cert-'))
  account = await startAccountStub()
  acme = await startFakeAcme({
    lookupTxt: (name) => account.challenges().get(name),
    lifetimeDays: 90,
    now: () => clock,
  })
  account.setPreview({ domain: 'preview.example:8443', acmeDirectory: acme.directoryUrl })
  const { accessToken } = await account.signIn('owner')
  const response = await fetch(`${account.url}${accountPaths.node(NODE_ID)}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ label: 'Laptop', fingerprint: 'ab'.repeat(32) }),
  })
  credential = registerNodeResponseSchema.parse(await response.json()).relay.credential
})

afterEach(async () => {
  vi.restoreAllMocks()
  manager?.close()
  manager = undefined
  await acme.close()
  await account.close()
  rmSync(dir, { recursive: true, force: true })
})

const start = (overrides: { accountUrl?: string; credential?: string } = {}) =>
  (manager = startCertificateManager({
    dir,
    nodeId: NODE_ID,
    accountUrl: account.url,
    credential,
    install: (certificate) => installed.push(certificate),
    now: () => clock,
    pollMs: 5,
    ...overrides,
  }))

async function settled(): Promise<void> {
  await manager!.check()
}

describe('the preview certificate', () => {
  it("gets a wildcard certificate for this Node's label, with a key that stays in its folder", async () => {
    start()
    await settled()
    const label = await previewNodeLabel(NODE_ID)
    expect(manager!.state()).toEqual({ status: 'ready' })
    expect(installed).toHaveLength(1)
    expect(installed[0]).toMatchObject({
      domain: 'preview.example:8443',
      domainHost: 'preview.example',
      nodeLabel: label,
    })
    // The challenge went to the account service under this Node's name, and the authority read it there.
    expect([...account.challenges().keys()]).toEqual([`_acme-challenge.${label}.preview.example`])
    expect(acme.issued()).toBe(1)
    expect(statSync(join(dir, 'cert.key.pem')).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(dir, 'cert.key.pem'), 'utf8')).toBe(installed[0]!.keyPem)
  })

  it('serves what it kept after a restart, and asks for nothing', async () => {
    start()
    await settled()
    manager!.close()
    installed.length = 0
    start()
    await settled()
    expect(installed).toHaveLength(1)
    expect(acme.issued()).toBe(1)
    // The port the service names is part of the address, and it can move without a new certificate.
    expect(installed[0]!.domain).toBe('preview.example:8443')
    manager!.close()
    account.setPreview({ domain: 'preview.example:9443', acmeDirectory: acme.directoryUrl })
    start()
    await settled()
    expect(installed.at(-1)!.domain).toBe('preview.example:9443')
    expect(acme.issued()).toBe(1)
  })

  it('renews when a third of the certificate is left, and not before', async () => {
    start()
    await settled()
    clock += 59 * 24 * 3600_000
    await manager!.check()
    expect(acme.issued()).toBe(1)
    clock += 2 * 24 * 3600_000
    await manager!.check()
    expect(acme.issued()).toBe(2)
    expect(installed).toHaveLength(3)
    expect(installed.at(-1)!.certPem).not.toBe(installed[0]!.certPem)
    expect(installed.at(-1)!.keyPem).not.toBe(installed[0]!.keyPem)
  })

  it('keeps serving a certificate it could not renew, and says when it ran out', async () => {
    start()
    await settled()
    clock += 70 * 24 * 3600_000
    acme.failNextChallenge()
    expect((await manager!.check()).status).toBe('ready')
    expect(manager!.state().error).toMatch(/refused/)
    clock += 30 * 24 * 3600_000
    expect(manager!.state().status).toBe('expired')
    // The next try works, and the state recovers.
    expect((await manager!.check()).status).toBe('ready')
    expect(manager!.state().error).toBeUndefined()
  })

  it('stays starting while the authority refuses the first order', async () => {
    acme.failNextChallenge()
    start()
    expect((await manager!.check()).status).toBe('starting')
    expect((await manager!.check()).status).toBe('ready')
  })

  it('is unsupported on a service with no preview domain', async () => {
    account.setPreview(undefined)
    start()
    await settled()
    expect(manager!.state()).toEqual({ status: 'unsupported' })
    expect(installed).toHaveLength(0)
  })

  it("does not publish a challenge with another Node's credential", async () => {
    start({ credential: 'not-a-credential' })
    const state = await manager!.check()
    expect(state.status).toBe('starting')
    expect(state.error).toMatch(/401/)
    expect(account.challenges().size).toBe(0)
  })
})

describe('the certificate authority the service names', () => {
  // Every address the Node asked for, so a refused one can be shown to get no request at all.
  const fetched = (): string[] => {
    const spy = vi.mocked(globalThis.fetch)
    return spy.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input))
  }
  beforeEach(() => void vi.spyOn(globalThis, 'fetch'))

  async function listen(handle: (path: string) => object): Promise<{ server: Server; url: string; hits: string[] }> {
    const hits: string[] = []
    const server = createServer((req, res) => {
      hits.push(req.url!)
      res
        .writeHead(200, { 'content-type': 'application/json', 'replay-nonce': 'n' })
        .end(JSON.stringify(handle(req.url!)))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits }
  }

  it("isn't asked when it's a cloud's metadata address", async () => {
    account.setPreview({ domain: 'preview.example', acmeDirectory: 'http://169.254.169.254/' })
    start()
    const state = await manager!.check()
    expect(state).toMatchObject({ status: 'starting', error: expect.stringMatching(/isn't a certificate authority/) })
    expect(fetched().filter((url) => url.includes('169.254.169.254'))).toEqual([])
    expect(account.challenges().size).toBe(0)
  })

  it('names no address off its own host that the Node then asks', async () => {
    const elsewhere = await listen(() => ({}))
    const directory = await listen(() => ({
      newNonce: `${elsewhere.url.replace('127.0.0.1', 'localhost')}/nonce`,
      newAccount: `${elsewhere.url}/account`,
      newOrder: `${elsewhere.url}/order`,
    }))
    try {
      account.setPreview({ domain: 'preview.example', acmeDirectory: `${directory.url}/directory` })
      start()
      expect((await manager!.check()).error).toMatch(/off http:\/\/127\.0\.0\.1/)
      expect(directory.hits).toEqual(['/directory'])
      expect(elsewhere.hits).toEqual([])
    } finally {
      directory.server.close()
      elsewhere.server.close()
    }
  })

  it.each([
    ['plain http to a public host', 'http://acme.example/directory', false],
    ['a private address', 'https://10.0.0.7/directory', false],
    ['a home router', 'https://192.168.1.1/directory', false],
    ['a link-local IPv6 address', 'https://[fe80::1]/directory', false],
    ['this computer, unless the caller allows it', 'https://127.0.0.1/directory', false],
    ['an IPv4 address written as IPv6', 'https://[::ffff:10.0.0.7]/directory', true],
  ])('refuses %s', async (_name, directoryUrl, allowLoopback) => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const ordering = obtainCertificate({
      directoryUrl,
      accountKey: privateKey,
      name: '*.n.preview.example',
      csr: Buffer.alloc(0),
      publishChallenge: async () => {},
      allowLoopback,
    })
    await expect(ordering).rejects.toThrow(/isn't a certificate authority/)
    expect(fetched()).toEqual([])
  })
})
