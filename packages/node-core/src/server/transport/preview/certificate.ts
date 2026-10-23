import { X509Certificate, createPrivateKey, generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type * as Forge from 'node-forge'
import { previewDomainHost, previewNodeLabel } from '@acorn/protocol/relay.ts'
import { createLogger } from '../../telemetry/logger'
import { obtainCertificate } from './acme'
import { fetchPreview, publishChallenge } from './accountPreview'
import type { PreviewResponse } from '@acorn/protocol/account.ts'

const log = createLogger('previews')
const require = createRequire(import.meta.url)

// The Node's certificate for its preview names, `*.<node>.<preview domain>` (docs/relay/phone-channel.md §
// Previews). The Node orders it from the authority the account service names, proves the name with a DNS
// challenge the account service publishes, and renews it before it runs out. The key is made here and never
// leaves this computer.

export type PreviewCertificate = {
  keyPem: string
  certPem: string
  notBefore: Date
  notAfter: Date
  /** The preview domain as the account service names it, with any port. */
  domain: string
  /** The same with no port, which is what the certificate and a server name carry. */
  domainHost: string
  /** This Node's label under that domain. */
  nodeLabel: string
}

// `starting`: no certificate yet. `ready`: one that hasn't run out. `expired`: one that did, and couldn't be
// renewed. `unsupported`: the account service has no preview domain.
type CertificateState = { status: 'starting' | 'ready' | 'expired' | 'unsupported'; error?: string }

export type CertificateManagerOptions = {
  /** Where the keys and certificate live, `<data root>/previews`. */
  dir: string
  nodeId: string
  accountUrl: string
  /** The Node's relay credential. */
  credential: string
  /** Called with the certificate to serve, when there is one and each time it is renewed. */
  install(certificate: PreviewCertificate): void
  now?: () => number
  /** Between polls of the certificate authority. A test shortens it. */
  pollMs?: number
}

export type CertificateManager = {
  state(): CertificateState
  /** Order or renew now if it is due, and report how it went. The manager calls this on its own schedule. */
  check(): Promise<CertificateState>
  close(): void
}

const HOUR_MS = 3600_000
// After a failure, how long to wait before the next try, by how many have failed in a row.
const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000, HOUR_MS]
// A certificate is renewed when a third of its life is left.
const renewalDue = (certificate: PreviewCertificate, now: number): boolean =>
  certificate.notAfter.getTime() - now < (certificate.notAfter.getTime() - certificate.notBefore.getTime()) / 3

export function startCertificateManager(options: CertificateManagerOptions): CertificateManager {
  const now = options.now ?? Date.now
  let certificate: PreviewCertificate | undefined
  let unsupported = false
  let lastError: string | undefined
  let failures = 0
  let timer: NodeJS.Timeout | undefined
  let closed = false
  let running: Promise<CertificateState> | undefined

  const state = (): CertificateState => {
    const status =
      unsupported && !certificate
        ? 'unsupported'
        : !certificate
          ? 'starting'
          : certificate.notAfter.getTime() <= now()
            ? 'expired'
            : 'ready'
    return { status, ...(lastError ? { error: lastError } : {}) }
  }

  async function order(preview: PreviewResponse): Promise<PreviewCertificate> {
    const domainHost = previewDomainHost(preview.domain)
    const nodeLabel = await previewNodeLabel(options.nodeId)
    const name = `*.${nodeLabel}.${domainHost}`
    const forge = require('node-forge') as typeof Forge
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    const csr = forge.pki.createCertificationRequest()
    csr.publicKey = forge.pki.publicKeyFromPem(publicKey)
    csr.setSubject([{ name: 'commonName', value: name }])
    csr.setAttributes([
      { name: 'extensionRequest', extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: name }] }] },
    ])
    csr.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create())
    const csrDer = Buffer.from(forge.asn1.toDer(forge.pki.certificationRequestToAsn1(csr)).getBytes(), 'binary')

    const certPem = await obtainCertificate({
      directoryUrl: preview!.acmeDirectory,
      accountKey: accountKey(options.dir),
      name,
      csr: csrDer,
      publishChallenge: (value) => publishChallenge(options.accountUrl, options.credential, value),
      pollMs: options.pollMs,
    })
    return parse(privateKey, certPem, preview.domain, nodeLabel)
  }

  async function step(): Promise<CertificateState> {
    try {
      const preview = await fetchPreview(options.accountUrl)
      unsupported = preview === null
      if (preview) {
        const domainHost = previewDomainHost(preview.domain)
        const nodeLabel = await previewNodeLabel(options.nodeId)
        certificate ??= load(options.dir, preview.domain, nodeLabel)
        if (certificate && (certificate.domainHost !== domainHost || certificate.nodeLabel !== nodeLabel))
          certificate = undefined
        // The service may move the port without changing the name.
        if (certificate && certificate.domain !== preview.domain)
          certificate = { ...certificate, domain: preview.domain }
        if (!certificate || renewalDue(certificate, now())) {
          log.info(`ordering a certificate for *.${nodeLabel}.${domainHost}`)
          certificate = save(options.dir, await order(preview))
        }
        options.install(certificate)
      }
      failures = 0
      lastError = undefined
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      // One line each time, and the retry schedule keeps a service that is down from filling the log.
      log.warn(`preview certificate: ${lastError}`)
      failures += 1
    }
    schedule()
    return state()
  }

  // The next try: soon after a failure, else when the certificate comes due, and at least hourly so a clock
  // jump or a service that gained a domain is noticed.
  function schedule(): void {
    if (closed) return
    clearTimeout(timer)
    const wait =
      failures > 0
        ? RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]!
        : certificate
          ? Math.min(
              HOUR_MS,
              Math.max(
                60_000,
                certificate.notAfter.getTime() -
                  (certificate.notAfter.getTime() - certificate.notBefore.getTime()) / 3 -
                  now(),
              ),
            )
          : HOUR_MS
    timer = setTimeout(() => void check(), wait)
    timer.unref()
  }

  const check = (): Promise<CertificateState> => (running ??= step().finally(() => (running = undefined)))
  void check()
  return {
    state,
    check,
    close() {
      closed = true
      clearTimeout(timer)
    },
  }
}

// The ACME account key, made once. The same key is the same account at the authority.
function accountKey(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, 'account.key.pem')
  if (!existsSync(path)) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  }
  return createPrivateKey(readFileSync(path))
}

function parse(keyPem: string, certPem: string, domain: string, nodeLabel: string): PreviewCertificate {
  const leaf = new X509Certificate(certPem)
  return {
    keyPem,
    certPem,
    notBefore: new Date(leaf.validFrom),
    notAfter: new Date(leaf.validTo),
    domain,
    domainHost: previewDomainHost(domain),
    nodeLabel,
  }
}

const FILES = { key: 'cert.key.pem', cert: 'cert.pem', meta: 'meta.json' }

// Write the key first and the label that says what they are for last, so a crash leaves no certificate that
// reads as complete.
function save(dir: string, certificate: PreviewCertificate): PreviewCertificate {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, FILES.key), certificate.keyPem, { mode: 0o600 })
  writeFileSync(join(dir, FILES.cert), certificate.certPem, { mode: 0o600 })
  writeFileSync(
    join(dir, FILES.meta),
    JSON.stringify({ domainHost: certificate.domainHost, nodeLabel: certificate.nodeLabel }),
    { mode: 0o600 },
  )
  for (const file of Object.values(FILES)) chmodSync(join(dir, file), 0o600)
  return certificate
}

// What an earlier run kept, if it is for this domain and Node.
function load(dir: string, domain: string, nodeLabel: string): PreviewCertificate | undefined {
  const domainHost = previewDomainHost(domain)
  try {
    const meta = JSON.parse(readFileSync(join(dir, FILES.meta), 'utf8')) as { domainHost?: string; nodeLabel?: string }
    if (meta.domainHost !== domainHost || meta.nodeLabel !== nodeLabel) return undefined
    return parse(
      readFileSync(join(dir, FILES.key), 'utf8'),
      readFileSync(join(dir, FILES.cert), 'utf8'),
      domain,
      nodeLabel,
    )
  } catch {
    return undefined
  }
}
