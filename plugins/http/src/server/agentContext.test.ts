// The redaction test, here rather than beside the route on purpose: this is the assertion that a
// captured snapshot can't carry a credential, and it has to hold over rows whose ciphertext has
// already been opened, which is the state the capture route reads them in.
import { describe, expect, it } from 'vitest'
import { redactUrl, requestOption, requestSnapshot } from './agentContext'
import type { HttpRequest } from '../shared/model'

const request = (over: Partial<HttpRequest> = {}): HttpRequest => ({
  id: 'req-1',
  projectId: 'proj-1',
  folder: 'auth',
  taskId: null,
  name: 'Login',
  method: 'POST',
  url: 'https://api.example.com/login',
  headers: [
    { name: 'X-Api-Key', value: 'sk-live-DEADBEEF', enabled: true },
    { name: 'X-Disabled', value: 'off', enabled: false },
  ],
  bodyMode: 'json',
  body: '{"password":"hunter2"}',
  auth: { mode: 'bearer', token: 'eyJhbGciOi-SECRET' },
  vars: { TOKEN: 'tok-SECRET' },
  createdAt: 1,
  updatedAt: 2,
  ...over,
})

describe('agent context snapshots', () => {
  it('carries the request shape', () => {
    const { content, label, deepLink, sensitivity } = requestSnapshot(request())
    expect(label).toBe('HTTP · Login')
    expect(content).toContain('POST https://api.example.com/login')
    expect(content).toContain('folder: auth; auth: bearer; body: json')
    // Names, and only the enabled ones.
    expect(content).toContain('header names: X-Api-Key')
    expect(content).not.toContain('X-Disabled')
    expect(deepLink).toEqual({ pane: 'http' })
    expect(sensitivity).toBe('private')
  })

  it('carries no credential-bearing value', () => {
    const { content } = requestSnapshot(request())
    for (const secret of ['sk-live-DEADBEEF', 'hunter2', 'eyJhbGciOi-SECRET', 'tok-SECRET']) {
      expect(content).not.toContain(secret)
    }
  })

  it('reports an unfiled request and no headers without leaving a gap', () => {
    const { content } = requestSnapshot(request({ folder: '', headers: [] }))
    expect(content).toContain('folder: /')
    expect(content).toContain('header names: none')
  })

  it('keys a snapshot by the request, so re-capturing replaces rather than duplicates', () => {
    expect(requestSnapshot(request()).contextId).toBe(requestSnapshot(request()).contextId)
  })

  it('describes an option by method and URL', () => {
    expect(requestOption(request())).toEqual({ id: 'req-1', label: 'Login', description: 'POST https://api.example.com/login' })
  })
})

describe('redactUrl', () => {
  it('leaves a URL with no query alone', () => {
    expect(redactUrl('https://api.example.com/v1/users')).toBe('https://api.example.com/v1/users')
    expect(redactUrl('{{BASE_URL}}/users')).toBe('{{BASE_URL}}/users')
  })

  it('keeps query keys and drops literal values', () => {
    expect(redactUrl('https://api.example.com/items?token=sk-live-DEADBEEF&page=2'))
      .toBe('https://api.example.com/items?token=•••&page=•••')
  })

  it('keeps a value that is only a variable reference, because that is shape not data', () => {
    expect(redactUrl('{{BASE}}/items?token={{TOKEN}}&page=2')).toBe('{{BASE}}/items?token={{TOKEN}}&page=•••')
  })

  it('handles the shapes that would otherwise slip through', () => {
    // A flag with no value has nothing to hide.
    expect(redactUrl('https://x.test/a?debug')).toBe('https://x.test/a?debug')
    // An empty value isn't a secret and stays readable as "this key exists".
    expect(redactUrl('https://x.test/a?q=')).toBe('https://x.test/a?q=')
    // A value containing '=' loses all of it, not just the first part.
    expect(redactUrl('https://x.test/a?sig=ab=cd')).toBe('https://x.test/a?sig=•••')
    // The fragment survives, and a '#' inside it doesn't split the URL twice.
    expect(redactUrl('https://x.test/a?k=v#frag#ment')).toBe('https://x.test/a?k=•••#frag#ment')
    // A trailing '?' with nothing after it doesn't leave a stray separator.
    expect(redactUrl('https://x.test/a?')).toBe('https://x.test/a')
  })
})
