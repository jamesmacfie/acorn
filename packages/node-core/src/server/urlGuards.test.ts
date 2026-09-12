import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from './urlGuards'

describe('isAllowedExternalUrl', () => {
  it('allows the three schemes a link in prose legitimately uses', () => {
    expect(isAllowedExternalUrl('https://github.com/acorn/acorn/pull/1')).toBe(true)
    expect(isAllowedExternalUrl('http://localhost:3000/')).toBe(true)
    expect(isAllowedExternalUrl('mailto:someone@example.com')).toBe(true)
  })

  it('blocks schemes that would launch something on the machine', () => {
    // The reason this guard exists: an href in third-party pane content (a Linear attachment URL, a
    // GitHub body) must not be able to make shell.openExternal launch a local bundle or another app.
    expect(isAllowedExternalUrl('file:///Applications/Calculator.app')).toBe(false)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isAllowedExternalUrl('vscode://file/etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('smb://attacker.example.com/share')).toBe(false)
  })

  it('blocks anything unparseable rather than guessing', () => {
    expect(isAllowedExternalUrl('')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
    expect(isAllowedExternalUrl('//evil.example.com/')).toBe(false) // protocol-relative: no scheme
  })
})
