import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// The Node's TLS identity (docs/vNext/security.md § Transport and authentication: "TLS 1.3
// everywhere, including loopback. Self-signed Node cert, pinned per node by the client at pairing
// time"). Generated once into the data root and reused for the node's whole life — the fingerprint IS
// the node's identity, so regenerating it would look to every paired client exactly like the attack
// the pin exists to catch.
//
// Shelling out to openssl rather than adding a dependency: node:crypto can PARSE an X509 but cannot
// sign one, and every platform we ship to has openssl on PATH (macOS, and any Linux with git).
// ponytail: if a target platform ever lacks it, the npm `selfsigned` package (pure JS, ~1 dep) is
// the drop-in replacement for generate() below — nothing else in this file changes.

const TLS_DIR = 'tls'
const KEY_FILE = 'key.pem'
const CERT_FILE = 'cert.pem'
// 20 years. A local dev tool that stops working on a Tuesday because a cert it minted itself expired
// is a worse failure than a long-lived key, and rotation means re-pairing every device.
const DAYS = '7300'

export type NodeCertificate = {
  keyPem: string
  certPem: string
  // sha256 of the DER, lowercase hex without separators. The broker normalizes both sides of the
  // comparison (main/nodeBroker.ts), so the only requirement here is that it is stable.
  fingerprint: string
}

export const certificateFingerprint = (certPem: string): string =>
  new X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase()

// Every extension is set EXPLICITLY rather than left to OpenSSL 3's `-x509` defaults, because two of
// them are load-bearing beyond "the handshake works":
//   basicConstraints CA:TRUE   lets this one file double as a trust anchor, so a spawned child gets
//                              full validation from NODE_EXTRA_CA_CERTS with zero code and no
//                              `rejectUnauthorized: false` anywhere (docs/mcp.md).
//   subjectAltName IP:127.0.0.1  is what makes that child's hostname check PASS instead of having to
//                              be disabled. A cert with only a CN is not matched by any modern client.
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
      // stdin ignored so a prompt can never hang boot; stderr captured for the error message below
      // (openssl writes only progress dots there, never key material).
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
  } catch (error) {
    // Never leave half a pair behind: a key with no cert would be read as "already provisioned" on
    // the next boot and fail somewhere much less explicable.
    rmSync(keyPath, { force: true })
    rmSync(certPath, { force: true })
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'acorn needs `openssl` on PATH to generate its TLS certificate, and it was not found. Install it (macOS: `brew install openssl`) and restart. acorn never falls back to plain HTTP — the certificate is the node\'s identity.',
      )
    }
    const stderr = (error as { stderr?: Buffer | string }).stderr
    throw new Error(`openssl failed to generate the node certificate: ${String(stderr ?? (error as Error).message).trim()}`)
  }
}

// Read (or, on first start, mint) this data root's certificate. Idempotent: a second call returns the
// same fingerprint, which is what makes it safe to call on every boot.
export function ensureCert(root: string): NodeCertificate {
  const dir = join(root, TLS_DIR)
  // 0700 BEFORE openssl runs: it writes the key under the ambient umask, so the directory — not a
  // post-hoc chmod — is what closes the window in which a 0644 private key exists.
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)

  const keyPath = join(dir, KEY_FILE)
  const certPath = join(dir, CERT_FILE)
  // Both or neither. Half a pair means an interrupted generate (or a hand-edited root), and the only
  // recovery that leaves a working node is to mint a fresh pair.
  if (!existsSync(keyPath) || !existsSync(certPath)) generate(keyPath, certPath)
  chmodSync(keyPath, 0o600)
  chmodSync(certPath, 0o600)

  const certPem = readFileSync(certPath, 'utf8')
  return { keyPem: readFileSync(keyPath, 'utf8'), certPem, fingerprint: certificateFingerprint(certPem) }
}
