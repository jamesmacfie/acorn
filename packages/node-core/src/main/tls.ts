import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const TLS_DIR = 'tls'
const KEY_FILE = 'key.pem'
const CERT_FILE = 'cert.pem'
// 20 years. A local tool that breaks one morning because a cert it minted itself expired is a worse
// failure than a long-lived key, and rotation means re-pairing every device.
const DAYS = '7300'

export type NodeCertificate = {
  keyPem: string
  certPem: string
  // sha256 of the DER, lowercase hex with no separators. The broker normalizes both sides of the
  // comparison, so the only requirement is that this stays stable.
  fingerprint: string
}

export const certificateFingerprint = (certPem: string): string =>
  new X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase()

// Set every extension explicitly rather than leaving it to OpenSSL 3's `-x509` defaults, because two
// carry weight beyond "the handshake works":
//   basicConstraints CA:TRUE     lets this one file double as a trust anchor, so a spawned child gets
//                                full validation from NODE_EXTRA_CA_CERTS with no code and no
//                                `rejectUnauthorized: false` anywhere (docs/mcp.md).
//   subjectAltName IP:127.0.0.1  makes that child's hostname check pass instead of having to be
//                                disabled. No client matches a cert with only a CN.
function generate(keyPath: string, certPath: string): void {
  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', DAYS,
        '-keyout', keyPath,
        '-out', certPath,
        '-subj', '/CN=acorn-node',
        '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
        '-addext', 'basicConstraints=critical,CA:TRUE',
        '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
      ],
      // stdin is ignored so a prompt cannot hang boot. stderr is captured for the error message
      // below, since openssl writes only progress dots there.
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
  } catch (error) {
    // Never leave half a pair behind. A key with no cert reads as "already provisioned" on the next
    // boot and fails somewhere far less explicable.
    rmSync(keyPath, { force: true })
    rmSync(certPath, { force: true })
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'acorn needs `openssl` on PATH to generate its TLS certificate, and it was not found. Install it, on macOS with `brew install openssl`, then restart. acorn never falls back to plain HTTP, because the certificate is the node\'s identity.',
      )
    }
    const stderr = (error as { stderr?: Buffer | string }).stderr
    throw new Error(`openssl failed to generate the node certificate: ${String(stderr ?? (error as Error).message).trim()}`)
  }
}

// Read this data root's certificate, minting it on first start. A second call returns the same
// fingerprint, so this is safe to call on every boot.
export function ensureCert(root: string): NodeCertificate {
  const dir = join(root, TLS_DIR)
  // 0700 before openssl runs. It writes the key under the ambient umask, so the directory mode, not a
  // later chmod, closes the window in which a 0644 private key exists.
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
