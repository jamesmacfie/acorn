import { X509Certificate } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureCert } from './tls'

const roots: string[] = []
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-tls-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const mode = (path: string): string => (statSync(path).mode & 0o777).toString(8)

describe('the node TLS identity (docs/security.md § Transport and authentication)', () => {
  it('mints a private key + certificate, and keeps both to the owner', () => {
    const dir = root()
    const cert = ensureCert(dir)
    expect(cert.keyPem).toContain('PRIVATE KEY')
    expect(cert.certPem).toContain('BEGIN CERTIFICATE')
    expect(mode(join(dir, 'tls'))).toBe('700')
    expect(mode(join(dir, 'tls/key.pem'))).toBe('600')
    expect(mode(join(dir, 'tls/cert.pem'))).toBe('600')
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
    const cert = ensureCert(root())
    const parsed = new X509Certificate(cert.certPem)
    expect(parsed.fingerprint256.replace(/:/g, '').toLowerCase()).toBe(cert.fingerprint)
  })

  // These three extensions are why the file is generated with explicit -addext rather than OpenSSL 3's
  // -x509 defaults, and each one buys something specific downstream.
  it('carries the loopback SAN, CA:TRUE and a long validity', () => {
    const parsed = new X509Certificate(ensureCert(root()).certPem)
    // The SAN is what lets a spawned Node child validate the hostname instead of disabling verification.
    expect(parsed.subjectAltName).toContain('127.0.0.1')
    expect(parsed.subjectAltName).toContain('localhost')
    // CA:TRUE is what lets the same file serve as a NODE_EXTRA_CA_CERTS trust anchor.
    expect(parsed.ca).toBe(true)
    // Rotation means re-pairing every device, so this outlives any plausible install.
    const years = (new Date(parsed.validTo).getTime() - Date.now()) / (365.25 * 24 * 3600_000)
    expect(years).toBeGreaterThan(10)
  })
})
