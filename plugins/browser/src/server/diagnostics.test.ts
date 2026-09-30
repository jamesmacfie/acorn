import { describe, expect, it } from 'vitest'
import { BrowserDiagnostics } from './diagnostics'

describe('browser diagnostic budgets', () => {
  it('truncates Unicode by UTF-8 bytes without splitting code points', () => {
    const diagnostics = new BrowserDiagnostics({ entries: 3, entryBytes: 29, totalBytes: 60 })
    diagnostics.append('error', '🙂漢'.repeat(10))
    const [line] = diagnostics.lines()
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(29)
    expect(line).toContain('[truncated]')
    expect(line).not.toContain('�')
    expect(line).toContain('🙂')
  })

  it('shares aggregate and count ceilings between errors and console output', () => {
    const diagnostics = new BrowserDiagnostics({ entries: 2, entryBytes: 40, totalBytes: 35 })
    diagnostics.append('error', 'first-error')
    diagnostics.append('log', 'second-log')
    diagnostics.append('error', 'third-error')
    expect(diagnostics.lines()).toEqual(['[log] second-log', '[error] third-error'])
    expect(diagnostics.lines().reduce((bytes, line) => bytes + Buffer.byteLength(line), 0)).toBeLessThanOrEqual(35)
    diagnostics.append('warn', 'last-message-is-long-enough-to-truncate')
    expect(diagnostics.lines()).toEqual(['[warn] last-message-… [truncated]'])
  })

  it('bounds kind strings and returns an independent copy', () => {
    const diagnostics = new BrowserDiagnostics({ entries: 1, entryBytes: 24, totalBytes: 24 })
    diagnostics.append('kind'.repeat(20), 'message')
    const lines = diagnostics.lines()
    expect(Buffer.byteLength(lines[0])).toBeLessThanOrEqual(24)
    expect(lines[0]).toContain('[truncated]')
    lines.push('not retained')
    expect(diagnostics.lines()).toHaveLength(1)
  })
})
