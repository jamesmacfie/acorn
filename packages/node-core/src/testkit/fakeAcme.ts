import { createHash, createPublicKey, generateKeyPairSync, randomBytes, verify, type webcrypto } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import type * as Forge from 'node-forge'

const require = createRequire(import.meta.url)

// A certificate authority that speaks enough ACME (RFC 8555) for one DNS-01 order, for the tests and the
// dev flows that need a Node to get a certificate with no internet. It isn't a mock of the client: it
// checks each request's signature, nonce, and address, looks the challenge up where the account stand-in
// published it, and signs a real certificate with a CA of its own, which a test then trusts.

export type FakeAcme = {
  directoryUrl: string
  /** The CA certificate, to trust. */
  caPem: string
  /** How many certificates it has signed. */
  issued(): number
  /** The requests it answered, as `METHOD path`. */
  requests(): string[]
  /** Refuse the next challenge as if the record weren't served. */
  failNextChallenge(): void
  close(): Promise<void>
}

export type FakeAcmeOptions = {
  /** What the authority sees in DNS: the TXT value at a name, if any. */
  lookupTxt(name: string): string | undefined
  /** How long a certificate lasts. */
  lifetimeDays?: number
  /** The clock, in epoch milliseconds, so a test can issue a certificate that is old already. */
  now?: () => number
}

type Authorization = { token: string; name: string; status: 'pending' | 'valid' | 'invalid' }
type Order = { name: string; authorization: string; status: 'pending' | 'ready' | 'valid'; certificate?: string }

type Jwk = webcrypto.JsonWebKey
const base64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url')

export async function startFakeAcme(options: FakeAcmeOptions): Promise<FakeAcme> {
  const forge = require('node-forge') as typeof Forge
  const now = options.now ?? Date.now
  const lifetimeMs = (options.lifetimeDays ?? 90) * 24 * 3600_000

  const caKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const caKey = forge.pki.privateKeyFromPem(caKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string)
  const caCert = forge.pki.createCertificate()
  caCert.publicKey = forge.pki.publicKeyFromPem(caKeys.publicKey.export({ type: 'spki', format: 'pem' }) as string)
  caCert.serialNumber = '01'
  caCert.validity.notBefore = new Date(now() - 3600_000)
  caCert.validity.notAfter = new Date(now() + 3650 * 24 * 3600_000)
  const caSubject = [{ name: 'commonName', value: 'Fake ACME CA' }]
  caCert.setSubject(caSubject)
  caCert.setIssuer(caSubject)
  caCert.setExtensions([
    { name: 'basicConstraints', critical: true, cA: true },
    { name: 'keyUsage', critical: true, keyCertSign: true, digitalSignature: true },
  ])
  caCert.sign(caKey, forge.md.sha256.create())
  const caPem = forge.pki.certificateToPem(caCert).replace(/\r\n/g, '\n')

  const nonces = new Set<string>()
  const accounts = new Map<string, Jwk>()
  const authorizations = new Map<string, Authorization>()
  const orders = new Map<string, Order>()
  const requests: string[] = []
  let issued = 0
  let failChallenge = false
  let base = ''

  const newNonce = (): string => {
    const nonce = randomBytes(12).toString('base64url')
    nonces.add(nonce)
    return nonce
  }
  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    res.writeHead(status, {
      'content-type': typeof body === 'string' ? 'application/pem-certificate-chain' : 'application/json',
      'replay-nonce': newNonce(),
      ...headers,
    })
    res.end(text)
  }
  const problem = (res: ServerResponse, status: number, type: string, detail: string): void =>
    send(res, status, { type: `urn:ietf:params:acme:error:${type}`, detail })

  const thumbprintOf = (jwk: Jwk): string =>
    base64url(
      createHash('sha256')
        .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
        .digest(),
    )

  // The payload of a signed request, once its signature, nonce, and address check out, and the key it came from.
  async function readSigned(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const envelope = JSON.parse(Buffer.concat(chunks).toString()) as {
      protected: string
      payload: string
      signature: string
    }
    const header = JSON.parse(Buffer.from(envelope.protected, 'base64url').toString()) as {
      alg: string
      nonce: string
      url: string
      jwk?: Jwk
      kid?: string
    }
    const jwk = header.jwk ?? accounts.get(header.kid ?? '')
    if (header.alg !== 'ES256' || !jwk) return void problem(res, 400, 'malformed', 'Unknown account or algorithm.')
    if (header.url !== `${base}${req.url}`)
      return void problem(res, 400, 'unauthorized', 'The signed address is not this one.')
    const signedBytes = Buffer.from(`${envelope.protected}.${envelope.payload}`)
    const valid = verify(
      'sha256',
      signedBytes,
      { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(envelope.signature, 'base64url'),
    )
    if (!valid) return void problem(res, 400, 'malformed', 'Bad signature.')
    if (!nonces.delete(header.nonce)) return void problem(res, 400, 'badNonce', 'Unknown nonce.')
    return {
      jwk,
      payload: envelope.payload
        ? (JSON.parse(Buffer.from(envelope.payload, 'base64url').toString()) as Record<string, unknown>)
        : undefined,
    }
  }

  function issue(order: Order, csrDer: Buffer): string {
    const csr = forge.pki.certificationRequestFromAsn1(
      forge.asn1.fromDer(forge.util.createBuffer(csrDer.toString('binary'))),
    )
    const cert = forge.pki.createCertificate()
    cert.publicKey = csr.publicKey!
    cert.serialNumber = `01${randomBytes(8).toString('hex')}`
    cert.validity.notBefore = new Date(now() - 60_000)
    cert.validity.notAfter = new Date(now() + lifetimeMs)
    cert.setSubject([])
    cert.setIssuer(caSubject)
    cert.setExtensions([
      { name: 'subjectAltName', altNames: [{ type: 2, value: order.name }] },
      { name: 'basicConstraints', cA: false },
    ])
    cert.sign(caKey, forge.md.sha256.create())
    issued += 1
    return forge.pki.certificateToPem(cert).replace(/\r\n/g, '\n') + caPem
  }

  const server: Server = createServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`)
    const path = req.url ?? '/'
    if (path === '/directory')
      return send(res, 200, {
        newNonce: `${base}/nonce`,
        newAccount: `${base}/account`,
        newOrder: `${base}/order`,
        meta: {},
      })
    if (path === '/nonce') return send(res, 200, '', { 'content-type': 'text/plain' })
    const signed = await readSigned(req, res)
    if (!signed) return
    const { jwk, payload } = signed

    if (path === '/account') {
      const id = thumbprintOf(jwk)
      accounts.set(`${base}/acct/${id}`, jwk)
      return send(res, 200, { status: 'valid' }, { location: `${base}/acct/${id}` })
    }
    if (path === '/order') {
      const identifier = (payload?.identifiers as { value: string }[] | undefined)?.[0]?.value ?? ''
      const id = randomBytes(6).toString('hex')
      // A wildcard's authorization is for the name without it.
      authorizations.set(id, {
        token: randomBytes(16).toString('base64url'),
        name: identifier.replace(/^\*\./, ''),
        status: 'pending',
      })
      orders.set(id, { name: identifier, authorization: id, status: 'pending' })
      return send(res, 201, orderBody(id), { location: `${base}/order/${id}` })
    }
    const [, kind, id] = path.split('/')
    const authorization = authorizations.get(id ?? '')
    const order = orders.get(id ?? '')
    if (kind === 'authz' && authorization) return send(res, 200, authorizationBody(id!))
    if (kind === 'challenge' && authorization) {
      const txt = options.lookupTxt(`_acme-challenge.${authorization.name}`)
      const expected = base64url(
        createHash('sha256')
          .update(`${authorization.token}.${thumbprintOf(jwk)}`)
          .digest(),
      )
      authorization.status = !failChallenge && txt === expected ? 'valid' : 'invalid'
      failChallenge = false
      if (authorization.status === 'valid') orders.get(id!)!.status = 'ready'
      return send(res, 200, authorizationBody(id!).challenges[0])
    }
    if (kind === 'finalize' && order) {
      if (order.status !== 'ready') return problem(res, 403, 'orderNotReady', 'The order is not ready.')
      order.certificate = issue(order, Buffer.from(String(payload?.csr), 'base64url'))
      order.status = 'valid'
      return send(res, 200, orderBody(id!))
    }
    if (kind === 'order' && order) return send(res, 200, orderBody(id!))
    if (kind === 'cert' && order?.certificate) return send(res, 200, order.certificate)
    return problem(res, 404, 'malformed', 'No such resource.')
  })

  const authorizationBody = (id: string) => {
    const authorization = authorizations.get(id)!
    return {
      status: authorization.status,
      identifier: { type: 'dns', value: authorization.name },
      challenges: [
        { type: 'dns-01', url: `${base}/challenge/${id}`, token: authorization.token, status: authorization.status },
      ],
    }
  }
  const orderBody = (id: string) => {
    const order = orders.get(id)!
    const authorization = authorizations.get(order.authorization)!
    return {
      status: authorization.status === 'invalid' ? 'invalid' : order.status,
      identifiers: [{ type: 'dns', value: order.name }],
      authorizations: [`${base}/authz/${order.authorization}`],
      finalize: `${base}/finalize/${id}`,
      ...(order.certificate ? { certificate: `${base}/cert/${id}` } : {}),
    }
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    directoryUrl: `${base}/directory`,
    caPem,
    issued: () => issued,
    requests: () => [...requests],
    failNextChallenge: () => (failChallenge = true),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
