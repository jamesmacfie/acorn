import { generateKeyPairSync, randomBytes, X509Certificate } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type * as Forge from 'node-forge'

const require = createRequire(import.meta.url)

const TLS_DIR = 'tls'
const KEY_FILE = 'key.pem'
const CERT_FILE = 'cert.pem'
// 20 years. A local tool that breaks one morning because a cert it minted itself expired is a worse
// failure than a long-lived key, and rotation means re-pairing every device.
const DAYS = 7300

export type NodeCertificate = {
  keyPem: string
  certPem: string
  // sha256 of the DER, lowercase hex with no separators. The broker normalizes both sides of the
  // comparison, so the only requirement is that this stays stable.
  fingerprint: string
}

export const certificateFingerprint = (certPem: string): string =>
  new X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase()

// These extensions support both pinned clients and child processes that use standard TLS validation:
//   basicConstraints CA:TRUE     lets this one file double as a trust anchor, so a spawned child gets
//                                full validation from NODE_EXTRA_CA_CERTS with no code and no
//                                `rejectUnauthorized: false` anywhere (docs/mcp.md).
//   subjectAltName IP:127.0.0.1  makes that child's hostname check pass instead of having to be
//                                disabled. No client matches a cert with only a CN.
function generate(keyPath: string, certPath: string): void {
  try {
    // Load the packaged certificate library only when minting an identity. Subsequent boots reuse
    // the PEM files without loading it. scripts/nodeRuntimePackages.ts owns its packaging.
    const forge = require('node-forge') as typeof Forge
    // Node generates the key using its native crypto implementation. Forge encodes and signs the
    // X.509 certificate without an OpenSSL executable on the host.
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    const cert = forge.pki.createCertificate()
    cert.publicKey = forge.pki.publicKeyFromPem(publicKey)
    // A positive, nonzero serial that fits the X.509 limit of 20 octets.
    cert.serialNumber = `01${randomBytes(19).toString('hex')}`
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date(cert.validity.notBefore.getTime() + DAYS * 24 * 3600_000)
    const subject = [{ name: 'commonName', value: 'acorn-node' }]
    cert.setSubject(subject)
    cert.setIssuer(subject)
    cert.setExtensions([
      { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }, { type: 2, value: 'localhost' }] },
      { name: 'basicConstraints', critical: true, cA: true },
      { name: 'keyUsage', critical: true, digitalSignature: true, keyEncipherment: true, keyCertSign: true },
    ])
    cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create())
    writeFileSync(keyPath, privateKey, { mode: 0o600 })
    // Match Node's peer-certificate PEM formatting and the files previously written by OpenSSL.
    writeFileSync(certPath, forge.pki.certificateToPem(cert).replace(/\r\n/g, '\n'), { mode: 0o600 })
  } catch (error) {
    // Never leave half a pair behind. A key with no cert reads as "already provisioned" on the next
    // boot and fails somewhere far less explicable.
    rmSync(keyPath, { force: true })
    rmSync(certPath, { force: true })
    throw new Error('Failed to generate the Node TLS certificate.', { cause: error })
  }
}

// Read this data root's certificate, minting it on first start. A second call returns the same
// fingerprint, so this is safe to call on every boot.
export function ensureCert(root: string): NodeCertificate {
  const dir = join(root, TLS_DIR)
  // Restrict access before writing either file, including when repairing an interrupted generation.
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)

  const keyPath = join(dir, KEY_FILE)
  const certPath = join(dir, CERT_FILE)
  // Both or neither. Half a pair means an interrupted generate or a hand-edited root, and the only
  // recovery that leaves a working node is a fresh pair.
  if (!existsSync(keyPath) || !existsSync(certPath)) generate(keyPath, certPath)
  chmodSync(keyPath, 0o600)
  chmodSync(certPath, 0o600)

  const certPem = readFileSync(certPath, 'utf8')
  return { keyPem: readFileSync(keyPath, 'utf8'), certPem, fingerprint: certificateFingerprint(certPem) }
}
