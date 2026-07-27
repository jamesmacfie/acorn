import { describe, expect, it } from 'vitest'
import { SendError, buildRequest, readCapped, type SendInput } from './send'

// buildRequest is where interpolation, auth compilation and the scheme check land — the parts that
// would silently send the wrong thing. The fetch call itself and the DB read around it are thin.

const input = (patch: Partial<SendInput> = {}): SendInput => ({
  method: 'GET',
  url: 'http://x/y',
  headers: [],
  bodyMode: 'none',
  body: '',
  auth: { mode: 'none' },
  vars: {},
  taskId: null,
  ...patch,
})

describe('buildRequest — scheme', () => {
  it('rejects anything that is not http or https', () => {
    for (const url of ['file:///etc/passwd', 'ftp://x/y', 'data:text/plain,hi']) {
      expect(() => buildRequest(input({ url }), {})).toThrow(SendError)
    }
  })

  it('rejects a URL that will not parse at all', () => {
    expect(() => buildRequest(input({ url: 'not a url' }), {})).toThrow(/Not a valid URL/)
  })

  it('accepts http and https', () => {
    expect(buildRequest(input({ url: 'http://x' }), {}).target.protocol).toBe('http:')
    expect(buildRequest(input({ url: 'https://x' }), {}).target.protocol).toBe('https:')
  })

  it('rejects a scheme smuggled in through a variable', () => {
    expect(() => buildRequest(input({ url: '{{BASE}}/y' }), { BASE: 'file:///etc' })).toThrow(SendError)
  })
})

describe('buildRequest — interpolation', () => {
  it('fills the URL from variables', () => {
    const { target } = buildRequest(input({ url: '{{BASE}}/users/{{id}}' }), { BASE: 'http://x', id: '7' })
    expect(target.toString()).toBe('http://x/users/7')
  })

  it('fills header names and values', () => {
    const { headers } = buildRequest(input({ headers: [{ name: 'X-{{H}}', value: '{{V}}', enabled: true }] }), { H: 'Trace', V: 'abc' })
    expect(headers.get('x-trace')).toBe('abc')
  })

  it('skips disabled and unnamed headers', () => {
    const { headers } = buildRequest(
      input({
        headers: [
          { name: 'A', value: '1', enabled: false },
          { name: '', value: '2', enabled: true },
        ],
      }),
      {},
    )
    expect([...headers.keys()]).toEqual([])
  })

  it('fills the body', () => {
    const { body } = buildRequest(input({ bodyMode: 'json', body: '{"id":"{{id}}"}' }), { id: '7' })
    expect(body).toBe('{"id":"7"}')
  })

  it('fills auth fields', () => {
    const { headers } = buildRequest(input({ auth: { mode: 'bearer', token: '{{TOKEN}}' } }), { TOKEN: 'sekrit' })
    expect(headers.get('authorization')).toBe('Bearer sekrit')
  })

  it('leaves an unresolved placeholder literal rather than sending "undefined"', () => {
    const { headers } = buildRequest(input({ headers: [{ name: 'A', value: '{{nope}}', enabled: true }] }), {})
    expect(headers.get('a')).toBe('{{nope}}')
  })
})

describe('buildRequest — content type', () => {
  it('defaults by body mode', () => {
    expect(buildRequest(input({ bodyMode: 'json', body: '{}' }), {}).headers.get('content-type')).toBe('application/json')
    expect(buildRequest(input({ bodyMode: 'text', body: 'hi' }), {}).headers.get('content-type')).toBe('text/plain')
    expect(buildRequest(input({ bodyMode: 'form', body: '[{"name":"a","value":"1","enabled":true}]' }), {}).headers.get('content-type')).toBe('application/x-www-form-urlencoded')
  })

  it('never overrides an explicit Content-Type', () => {
    const { headers } = buildRequest(input({ bodyMode: 'json', body: '{}', headers: [{ name: 'Content-Type', value: 'application/vnd.api+json', enabled: true }] }), {})
    expect(headers.get('content-type')).toBe('application/vnd.api+json')
  })

  it('sets no content type when there is no body', () => {
    expect(buildRequest(input({ bodyMode: 'none' }), {}).headers.has('content-type')).toBe(false)
    expect(buildRequest(input({ bodyMode: 'json', body: '' }), {}).body).toBeUndefined()
  })
})

describe('buildRequest — api key placement', () => {
  it('adds a header key as a header', () => {
    const { target, headers } = buildRequest(input({ auth: { mode: 'apikey', key: 'X-Key', value: 'k', placement: 'header' } }), {})
    expect(headers.get('x-key')).toBe('k')
    expect(target.search).toBe('')
  })

  it('merges a query key into the URL alongside existing params', () => {
    const { target, headers } = buildRequest(input({ url: 'http://x/y?a=1', auth: { mode: 'apikey', key: 'k', value: 'v', placement: 'query' } }), {})
    expect(target.searchParams.get('a')).toBe('1')
    expect(target.searchParams.get('k')).toBe('v')
    expect(headers.has('k')).toBe(false)
  })
})

describe('readCapped', () => {
  const streamOf = (chunks: Uint8Array[]): Response =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(c)
          controller.close()
        },
      }),
    )

  it('returns the whole body when it fits', async () => {
    const { bytes, truncated } = await readCapped(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]))
    expect([...bytes]).toEqual([1, 2, 3])
    expect(truncated).toBe(false)
  })

  it('handles an empty body', async () => {
    const { bytes, truncated } = await readCapped(new Response(null))
    expect(bytes.byteLength).toBe(0)
    expect(truncated).toBe(false)
  })

  it('stops at the 5 MB cap and flags it', async () => {
    // Two 4 MB chunks: the first fits, the second is cut short at the cap.
    const chunk = new Uint8Array(4 * 1024 * 1024).fill(7)
    const { bytes, truncated } = await readCapped(streamOf([chunk, chunk]))
    expect(bytes.byteLength).toBe(5 * 1024 * 1024)
    expect(truncated).toBe(true)
    expect(bytes[bytes.byteLength - 1]).toBe(7)
  })
})
