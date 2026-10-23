import { createHash, sign, type KeyObject } from 'node:crypto'

// Just enough of ACME (RFC 8555) to get one wildcard certificate with a DNS-01 challenge: an account
// that signs with ES256, one order, one authorization, and a finalize with a CSR the caller built. It is
// the whole client, so a Node with Remote access on adds no library to its install. Every request is
// signed with a fresh nonce, and a nonce the server rejects is retried once.

class AcmeError extends Error {}

export type AcmeRequest = {
  directoryUrl: string
  /** The account's ES256 private key. The same key is the same account, so it is kept between orders. */
  accountKey: KeyObject
  /** The name to certify, such as `*.node.preview.example`. */
  name: string
  /** A DER certificate signing request for `name`. */
  csr: Buffer
  /** Make `value` the TXT record at `_acme-challenge.<name without the wildcard>`, and answer once it's served. */
  publishChallenge(value: string): Promise<void>
  /** Between polls of the authority. A test shortens it. */
  pollMs?: number
}

type Order = { status: string; authorizations: string[]; finalize: string; certificate?: string }
type Authorization = {
  status: string
  challenges: { type: string; url: string; token: string; status: string }[]
}

const base64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url')
const POLL_LIMIT = 120

export async function obtainCertificate(request: AcmeRequest): Promise<string> {
  const { accountKey } = request
  const pollMs = request.pollMs ?? 2_000
  // The public half only: the exported private key carries `d`, which must never be sent.
  const { crv, kty, x, y } = accountKey.export({ format: 'jwk' })
  const jwk = { crv, kty, x, y }
  // RFC 7638: the members in order, with no space.
  const thumbprint = base64url(createHash('sha256').update(JSON.stringify(jwk)).digest())
  const directory = (await getJson(request.directoryUrl)) as { newNonce: string; newAccount: string; newOrder: string }
  let nonce: string | undefined
  let accountUrl: string | undefined

  // A signed POST. `payload` undefined is a POST-as-GET.
  async function post(url: string, payload: unknown, retry = true): Promise<{ body: unknown; response: Response }> {
    nonce ??= (await fetch(directory.newNonce, { method: 'HEAD' })).headers.get('replay-nonce') ?? undefined
    if (!nonce) throw new AcmeError('The certificate authority gave no nonce.')
    const header = { alg: 'ES256', nonce, url, ...(accountUrl ? { kid: accountUrl } : { jwk }) }
    const protectedPart = base64url(JSON.stringify(header))
    const payloadPart = payload === undefined ? '' : base64url(JSON.stringify(payload))
    const signature = sign('sha256', Buffer.from(`${protectedPart}.${payloadPart}`), {
      key: accountKey,
      dsaEncoding: 'ieee-p1363',
    })
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/jose+json' },
      body: JSON.stringify({ protected: protectedPart, payload: payloadPart, signature: base64url(signature) }),
    })
    nonce = response.headers.get('replay-nonce') ?? undefined
    const text = await response.text()
    if (!response.ok) {
      const problem = (parseJson(text) ?? {}) as { type?: string; detail?: string }
      if (retry && problem.type === 'urn:ietf:params:acme:error:badNonce') return post(url, payload, false)
      throw new AcmeError(`${url} answered ${response.status}: ${problem.detail ?? text.slice(0, 200)}`)
    }
    return { body: parseJson(text) ?? text, response }
  }

  async function poll<T extends { status: string }>(url: string, done: (value: T) => boolean): Promise<T> {
    for (let attempt = 0; attempt < POLL_LIMIT; attempt++) {
      const { body } = await post(url, undefined)
      const value = body as T
      if (value.status === 'invalid') throw new AcmeError(`${url} was refused: ${JSON.stringify(body).slice(0, 300)}`)
      if (done(value)) return value
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
    throw new AcmeError(`${url} did not finish.`)
  }

  const account = await post(directory.newAccount, { termsOfServiceAgreed: true })
  accountUrl = account.response.headers.get('location') ?? undefined
  if (!accountUrl) throw new AcmeError('The certificate authority gave no account address.')

  const created = await post(directory.newOrder, { identifiers: [{ type: 'dns', value: request.name }] })
  const orderUrl = created.response.headers.get('location')
  if (!orderUrl) throw new AcmeError('The certificate authority gave no order address.')
  const order = created.body as Order

  for (const authorizationUrl of order.authorizations) {
    const { body } = await post(authorizationUrl, undefined)
    const authorization = body as Authorization
    if (authorization.status === 'valid') continue
    const challenge = authorization.challenges.find((candidate) => candidate.type === 'dns-01')
    if (!challenge) throw new AcmeError('The certificate authority offered no DNS challenge.')
    await request.publishChallenge(base64url(createHash('sha256').update(`${challenge.token}.${thumbprint}`).digest()))
    await post(challenge.url, {})
    await poll<Authorization>(authorizationUrl, (value) => value.status === 'valid')
  }

  await post(order.finalize, { csr: base64url(request.csr) })
  const finished = await poll<Order>(orderUrl, (value) => value.status === 'valid' && !!value.certificate)
  const { body } = await post(finished.certificate!, undefined)
  if (typeof body !== 'string' || !body.includes('BEGIN CERTIFICATE'))
    throw new AcmeError('The certificate authority sent no certificate.')
  return body
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new AcmeError(`${url} answered ${response.status}.`)
  return response.json()
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
