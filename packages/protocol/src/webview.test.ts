import { describe, expect, it } from 'vitest'
import { isAllowedWebviewUrl, normalizeWebviewHost, webviewHostMatches } from './webview'

describe('plugin webview hosts', () => {
  it('normalizes literal and wildcard hosts without widening their shape', () => {
    expect(normalizeWebviewHost('Docs.Example.com')).toBe('docs.example.com')
    expect(normalizeWebviewHost('*.Example.com')).toBe('*.example.com')
    expect(() => normalizeWebviewHost('*.*.example.com')).toThrow()
    expect(() => normalizeWebviewHost('example')).toThrow()
  })

  it('matches wildcard subdomains and their apex, consistently with content-link hosts', () => {
    expect(webviewHostMatches('api.example.com', '*.example.com')).toBe(true)
    expect(webviewHostMatches('example.com', '*.example.com')).toBe(true)
    expect(webviewHostMatches('notexample.com', '*.example.com')).toBe(false)
  })

  it('allows https and the narrow loopback http carve-out only', () => {
    expect(isAllowedWebviewUrl('https://docs.example.com/start', ['docs.example.com'])).toBe(true)
    expect(isAllowedWebviewUrl('http://localhost:3000/start', ['localhost'])).toBe(true)
    expect(isAllowedWebviewUrl('http://127.0.0.1:3000/start', ['127.0.0.1'])).toBe(true)
    expect(isAllowedWebviewUrl('http://docs.example.com/start', ['docs.example.com'])).toBe(false)
    expect(isAllowedWebviewUrl('https://docs.example.com@evil.test/', ['docs.example.com'])).toBe(false)
  })
})
