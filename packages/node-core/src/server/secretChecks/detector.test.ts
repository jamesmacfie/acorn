import { describe, expect, it } from 'vitest'
import {
  decodeSecretInput,
  MAX_SECRET_FINDINGS,
  redactSecretText,
  scanSecretText,
  SECRET_REDACTION,
  secretReport,
} from './detector'

// Synthetic credentials, assembled at runtime so no literal token sits in this file for a provider's
// push protection, or this detector, to find. None of them was ever issued.
const body = (length: number, seed = 7) =>
  Array.from({ length }, (_, index) => 'A1b2C3d4E5f6G7h8J9k0LmNpQrStUvWxYz'[(index * seed + 3) % 34]).join('')
export const SYNTHETIC = {
  'aws-access-key-id': 'AKIA' + 'Z7XQ4PLM2NVB6WRT',
  'github-token': 'ghp' + '_' + body(36),
  'gitlab-token': 'glpat' + '-' + body(20),
  'slack-token': 'xoxb' + '-123456789012-' + body(24),
  'slack-webhook': 'https://hooks.slack.com/services/' + 'T0A1B2C3D/B0A1B2C3D/' + body(24),
  'stripe-secret-key': 'sk' + '_live_' + body(30),
  'anthropic-api-key': 'sk-ant' + '-api03-' + body(90),
  'openai-api-key': 'sk-' + 'proj-' + body(48),
  'google-api-key': 'AIza' + body(35),
  'npm-token': 'npm' + '_' + body(36),
  'private-key': '-----BEGIN ' + 'RSA PRIVATE KEY-----\n' + body(64) + '\n-----END RSA PRIVATE KEY-----',
} as const

describe('scanSecretText', () => {
  it.each(Object.entries(SYNTHETIC))('finds %s with its position and no value', (rule, token) => {
    const text = `first line\nconst value = "${token}"\n`
    const findings = scanSecretText(text, 'src/config.ts')
    expect(findings).toEqual([{ rule, confidence: 'high', location: 'src/config.ts', line: 2, column: 16 }])
    expect(JSON.stringify(findings)).not.toContain(token.slice(4, 20))
  })

  it('passes narrow placeholders', () => {
    const text = [
      'AKIAIOSFODNN7EXAMPLE',
      'ghp_' + 'x'.repeat(36),
      'api_key = "your-api-key-goes-here"',
      'password: "${DATABASE_PASSWORD}"',
      'token = "changeme-changeme-123"',
    ].join('\n')
    expect(scanSecretText(text, 'README.md')).toEqual([])
  })

  it('reports heuristics as heuristic, never high', () => {
    const jwt = 'eyJ' + body(20) + '.eyJ' + body(30) + '.' + body(40)
    const text = [
      `const auth = "${jwt}"`,
      `DATABASE_URL=postgres://app:${body(16)}@db.internal/app`,
      `client_secret = "${body(32, 11)}"`,
    ].join('\n')
    expect(scanSecretText(text, 'x').map((finding) => [finding.rule, finding.confidence])).toEqual([
      ['jwt', 'heuristic'],
      ['url-password', 'heuristic'],
      ['credential-assignment', 'heuristic'],
    ])
  })

  it('ignores a readable low-entropy assignment', () => {
    expect(scanSecretText('password = "correcthorsebattery"', 'x')).toEqual([])
  })
})

describe('redactSecretText', () => {
  it('replaces each match with one fixed marker and keeps the rest', () => {
    const token = SYNTHETIC['github-token']
    const redacted = redactSecretText(`use ${token} here`)
    expect(redacted).toBe(`use ${SECRET_REDACTION} here`)
    expect(scanSecretText(redacted, 'x')).toEqual([])
  })

  it('keeps the key name and redacts only the value of an assignment', () => {
    const value = body(32, 11)
    expect(redactSecretText(`client_secret = "${value}"`)).toBe(`client_secret = "${SECRET_REDACTION}"`)
  })
})

describe('decodeSecretInput', () => {
  it('refuses binary, damaged UTF-8, and oversized input rather than guessing', () => {
    expect(decodeSecretInput(new Uint8Array([0x61, 0, 0x62]), 100)).toEqual({ unscanned: 'Binary content.' })
    expect(decodeSecretInput(new Uint8Array([0xff, 0xfe, 0x61]), 100)).toEqual({ unscanned: 'Not valid UTF-8.' })
    expect('unscanned' in decodeSecretInput(new Uint8Array(2048), 1024)).toBe(true)
    expect(decodeSecretInput(new TextEncoder().encode('ok'), 100)).toEqual({ text: 'ok' })
  })
})

describe('secretReport', () => {
  it('keeps exact counts past the finding limit and puts high findings first', () => {
    const findings = [
      ...Array.from({ length: MAX_SECRET_FINDINGS }, () => ({
        rule: 'jwt',
        confidence: 'heuristic' as const,
        location: 'a',
        line: 1,
        column: 1,
      })),
      { rule: 'npm-token', confidence: 'high' as const, location: 'b', line: 2, column: 1 },
    ]
    const report = secretReport({ digest: 'd', findings })
    expect(report.counts).toEqual({ high: 1, heuristic: MAX_SECRET_FINDINGS })
    expect(report.truncated).toBe(true)
    expect(report.findings[0]!.rule).toBe('npm-token')
    expect(report.complete).toBe(true)
  })

  it('is incomplete when anything was unscanned or the check stopped', () => {
    expect(
      secretReport({ digest: 'd', findings: [], unscanned: [{ location: 'a.png', reason: 'Binary content.' }] })
        .complete,
    ).toBe(false)
    expect(secretReport({ digest: 'd', findings: [], stopped: true }).complete).toBe(false)
  })
})
