import { describe, expect, it } from 'vitest'
import { providerStderrNotice, safeProviderMessage } from './diagnostics'

describe('provider diagnostics', () => {
  it('redacts internal environment values and common credential shapes', () => {
    const internal = 'internal-token-value'
    const message = safeProviderMessage(
      `Authorization: Bearer abcdefghijklmnop token=${internal} sk-secretvalue`,
      'Provider failed.',
      [internal],
    )
    expect(message).not.toContain(internal)
    expect(message).not.toContain('abcdefghijklmnop')
    expect(message).not.toContain('sk-secretvalue')
    expect(message).toContain('<redacted>')
  })

  it('does not persist raw provider stderr', () => {
    expect(providerStderrNotice('Codex', 123)).toBe(
      'Codex wrote 123 bytes to its diagnostic stream; content was redacted.',
    )
  })
})
