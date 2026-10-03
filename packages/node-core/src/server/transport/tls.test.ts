import { createPrivateKey, X509Certificate } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ensureCert, type NodeCertificate } from './tls'

const roots: string[] = []
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-tls-'))
  roots.push(dir)
  return dir
}
// afterAll, not afterEach: the shared mint above is made once, and an afterEach would delete its
// root before the tests that read it ran.
afterAll(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const mode = (path: string): string => (statSync(path).mode & 0o777).toString(8)

// One mint for the two tests that only read a certificate's contents. The two that exercise
// generation and reuse below keep their own fresh roots, since that is what they are about.
let minted: NodeCertificate
beforeAll(() => {
  minted = ensureCert(root())
})

describe('the node TLS identity (docs/security/transport-and-auth.md § Transport)', () => {
  it('mints a private key + certificate, and keeps both to the owner', () => {
    const dir = root()
    const cert = ensureCert(dir)
    expect(cert.keyPem).toContain('PRIVATE KEY')
    expect(cert.certPem).toContain('BEGIN CERTIFICATE')
    // Windows uses the data root's inherited ACL rather than POSIX permission bits.
    if (process.platform !== 'win32') {
      expect(mode(join(dir, 'tls'))).toBe('700')
      expect(mode(join(dir, 'tls/key.pem'))).toBe('600')
      expect(mode(join(dir, 'tls/cert.pem'))).toBe('600')
    }
  })

  it('provisions a fresh identity without host executables on PATH', () => {
    vi.stubEnv('PATH', '')
    try {
      const cert = ensureCert(root())
      const parsed = new X509Certificate(cert.certPem)
      expect(parsed.checkPrivateKey(createPrivateKey(cert.keyPem))).toBe(true)
      expect(parsed.verify(parsed.publicKey)).toBe(true)
      expect(parsed.publicKey.asymmetricKeyType).toBe('rsa')
      expect(parsed.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  // The fingerprint IS the node's identity: a second call that minted a fresh pair would look to every
  // paired client exactly like the machine-in-the-middle the pin exists to catch.
  it('is stable across calls', () => {
    const dir = root()
    const first = ensureCert(dir)
    const second = ensureCert(dir)
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(second.certPem).toBe(first.certPem)
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reports the certificate sha256 that a TLS peer will see', () => {
    const parsed = new X509Certificate(minted.certPem)
    expect(parsed.fingerprint256.replace(/:/g, '').toLowerCase()).toBe(minted.fingerprint)
  })

  it.each(['key.pem', 'cert.pem'])('recovers an interrupted generation missing %s', (missing) => {
    const dir = root()
    const first = ensureCert(dir)
    rmSync(join(dir, 'tls', missing))
    const recovered = ensureCert(dir)
    expect(recovered.fingerprint).not.toBe(first.fingerprint)
    expect(new X509Certificate(recovered.certPem).checkPrivateKey(createPrivateKey(recovered.keyPem))).toBe(true)
    expect(ensureCert(dir).fingerprint).toBe(recovered.fingerprint)
  })

  it('carries the loopback SAN, CA:TRUE and a long validity', () => {
    const parsed = new X509Certificate(minted.certPem)
    // The SAN is what lets a spawned Node child validate the hostname instead of disabling verification.
    expect(parsed.subjectAltName).toContain('127.0.0.1')
    expect(parsed.subjectAltName).toContain('localhost')
    expect(parsed.checkIP('127.0.0.1')).toBe('127.0.0.1')
    expect(parsed.checkHost('localhost')).toBe('localhost')
    // CA:TRUE is what lets the same file serve as a NODE_EXTRA_CA_CERTS trust anchor.
    expect(parsed.ca).toBe(true)
    // Rotation means re-pairing every device, so this outlives any plausible install.
    const years = (new Date(parsed.validTo).getTime() - Date.now()) / (365.25 * 24 * 3600_000)
    expect(years).toBeGreaterThan(10)
  })
})
