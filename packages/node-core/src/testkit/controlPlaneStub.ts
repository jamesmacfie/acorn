import { createServer, type Server } from 'node:http'
import { enrollmentRequestSchema, ENROLLMENT_PATH, type EnrollmentRequest } from '@acorn/protocol/enrollment.ts'

// A control plane, in fifty lines, for the tests that need one to exist
// (docs/node-enrollment.md § Testing against a stub).
//
// It is deliberately not a mock. It validates the payload against `enrollmentRequestSchema`, the same
// schema the protocol document publishes, so a node that changes what it posts fails here rather than
// in a green suite. That is the whole argument for owning the protocol from the first commit: if this
// stub can be written from the document, so can somebody else's real one.
//
// What it does not do is any part of a real control plane's job: no accounts, no database, no vouching
// for a node to a client. It accepts an enrollment, spends the token once, and remembers what it was
// told.

export type ControlPlaneStub = {
  url: string
  /** Every accepted enrollment, in order. The "inventory" a node has to appear in. */
  inventory(): EnrollmentRequest[]
  /** Rejections, so a test can assert on a refusal instead of only on an absence. */
  rejections(): string[]
  close(): Promise<void>
}

export type ControlPlaneStubOptions = {
  /** Tokens this stub will accept, each exactly once. Anything else is a 401. */
  tokens: readonly string[]
  /** What to call itself in the acknowledgement, which the node stores and shows its owner. */
  name?: string
  /** Fail the first N attempts, so the bounded retry can be exercised. */
  failFirst?: number
}

export async function startControlPlaneStub(options: ControlPlaneStubOptions): Promise<ControlPlaneStub> {
  const unspent = new Set(options.tokens)
  const accepted: EnrollmentRequest[] = []
  const rejected: string[] = []
  let failuresLeft = options.failFirst ?? 0

  const server = createServer((request, response) => {
    const reject = (status: number, reason: string): void => {
      rejected.push(reason)
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: reason }))
    }
    if (request.method !== 'POST' || request.url !== ENROLLMENT_PATH) return reject(404, `no route for ${request.method} ${request.url}`)
    // A forced failure first, and before the token is spent, because that is what a transient failure
    // is: the control plane never recorded the enrollment, so the token is still good and the node's
    // retry is supposed to work.
    if (failuresLeft > 0) {
      failuresLeft -= 1
      return reject(503, 'stub asked to fail this attempt')
    }
    // Single-use, and checked before the body is read: a spent token buys nothing, however well-formed
    // the payload behind it (docs/node-enrollment.md § The two tokens).
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
    if (!unspent.delete(token)) return reject(401, 'unknown or already-spent enrollment token')
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const parsed = enrollmentRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      if (!parsed.success) return reject(400, `payload does not match the published schema: ${parsed.error.issues[0]?.message}`)
      accepted.push(parsed.data)
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ controlPlaneName: options.name ?? 'Stub control plane' }))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('the control plane stub did not bind a port')

  return {
    // Loopback http, which `checkControlPlaneUrl` allows for exactly this reason: a stub and a local
    // development control plane are the only plaintext cases, and anything off this machine needs https.
    url: `http://127.0.0.1:${address.port}`,
    inventory: () => [...accepted],
    rejections: () => [...rejected],
    close: () => new Promise<void>((resolve) => (server as Server).close(() => resolve())),
  }
}
