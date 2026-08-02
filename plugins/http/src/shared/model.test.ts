import { describe, expect, it } from 'vitest'
import { applyAuth, fromCurl, interpolate, joinUrl, missingVars, serializeBody, splitUrl, toCurl, tokenizeShell, type AuthConfig } from './model'

describe('interpolate', () => {
  it('substitutes known variables and leaves unknown ones literal', () => {
    expect(interpolate('{{base}}/users/{{id}}', { base: 'http://x', id: '7' })).toBe('http://x/users/7')
    expect(interpolate('{{base}}/{{nope}}', { base: 'http://x' })).toBe('http://x/{{nope}}')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(interpolate('{{ base }}', { base: 'ok' })).toBe('ok')
  })

  it('does not recurse — a value containing a placeholder is inserted verbatim', () => {
    expect(interpolate('{{a}}', { a: '{{b}}', b: 'deep' })).toBe('{{b}}')
  })

  it('reports which names are missing', () => {
    expect(missingVars('{{a}}/{{b}}/{{a}}', { a: '1' })).toEqual(['b'])
  })
})

describe('applyAuth', () => {
  it('builds a bearer header', () => {
    expect(applyAuth({ mode: 'bearer', token: 'abc' }).headers).toEqual([{ name: 'Authorization', value: 'Bearer abc', enabled: true }])
  })

  it('base64-encodes basic credentials', () => {
    expect(applyAuth({ mode: 'basic', username: 'u', password: 'p' }).headers[0].value).toBe('Basic dTpw')
  })

  it('handles non-Latin-1 passwords without throwing', () => {
    const value = applyAuth({ mode: 'basic', username: 'u', password: 'pä€' }).headers[0].value
    expect(value.startsWith('Basic ')).toBe(true)
    // atob yields a Latin-1 byte string; decode those bytes as UTF-8 to get the credentials back.
    const bytes = Uint8Array.from(atob(value.slice(6)), (c) => c.charCodeAt(0))
    expect(new TextDecoder().decode(bytes)).toBe('u:pä€')
  })

  it('places an api key in the header or the query per placement', () => {
    const header: AuthConfig = { mode: 'apikey', key: 'X-Key', value: 'k', placement: 'header' }
    const query: AuthConfig = { ...header, placement: 'query' } as AuthConfig
    expect(applyAuth(header).headers).toHaveLength(1)
    expect(applyAuth(header).queryParams).toHaveLength(0)
    expect(applyAuth(query).headers).toHaveLength(0)
    expect(applyAuth(query).queryParams).toHaveLength(1)
  })

  it('adds nothing for mode none', () => {
    expect(applyAuth({ mode: 'none' })).toEqual({ headers: [], queryParams: [] })
  })
})

describe('splitUrl / joinUrl', () => {
  it('round-trips a plain query string', () => {
    const { base, params } = splitUrl('http://x/y?a=1&b=2')
    expect(base).toBe('http://x/y')
    expect(params.map((p) => [p.name, p.value])).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])
    expect(joinUrl(base, params)).toBe('http://x/y?a=1&b=2')
  })

  it('leaves {{placeholders}} unencoded — the WHATWG parser would mangle them', () => {
    expect(joinUrl('{{base}}/y', [{ name: 'id', value: '{{id}}', enabled: true }])).toBe('{{base}}/y?id={{id}}')
  })

  it('encodes everything that is not a placeholder', () => {
    expect(joinUrl('http://x', [{ name: 'q', value: 'a b&c', enabled: true }])).toBe('http://x?q=a%20b%26c')
  })

  it('drops disabled and unnamed params', () => {
    expect(joinUrl('http://x', [{ name: 'a', value: '1', enabled: false }])).toBe('http://x')
    expect(joinUrl('http://x', [{ name: '', value: '1', enabled: true }])).toBe('http://x')
  })

  it('handles a valueless param and a bare ?', () => {
    expect(splitUrl('http://x?flag').params).toEqual([{ name: 'flag', value: '', enabled: true }])
    expect(splitUrl('http://x?').params).toEqual([])
  })
})

describe('tokenizeShell', () => {
  it('keeps quoted spans together', () => {
    expect(tokenizeShell(`curl -H 'a: b c' "d e"`)).toEqual(['curl', '-H', 'a: b c', 'd e'])
  })

  it('honours backslash escapes outside and inside double quotes', () => {
    expect(tokenizeShell(String.raw`a\ b "c\"d"`)).toEqual(['a b', 'c"d'])
  })

  it('treats single quotes as fully literal', () => {
    expect(tokenizeShell(String.raw`'a\"b'`)).toEqual([String.raw`a\"b`])
  })

  it('preserves a deliberately empty argument', () => {
    expect(tokenizeShell(`curl -d ''`)).toEqual(['curl', '-d', ''])
  })
})

describe('fromCurl', () => {
  it('rejects input that is not a curl command', () => {
    expect(fromCurl('wget http://x')).toBeNull()
    expect(fromCurl('curl')).toBeNull() // no URL
  })

  it('parses method, headers and a JSON body across line continuations', () => {
    const parsed = fromCurl(`curl -X POST 'http://x/y' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"a":1}'`)
    expect(parsed).toMatchObject({ method: 'POST', url: 'http://x/y', bodyMode: 'json', body: '{"a":1}' })
    expect(parsed?.headers).toEqual([{ name: 'Content-Type', value: 'application/json', enabled: true }])
  })

  it('infers POST when a body is present and no -X was given', () => {
    expect(fromCurl(`curl http://x -d 'a=1'`)?.method).toBe('POST')
    expect(fromCurl('curl http://x')?.method).toBe('GET')
  })

  it('turns -u into basic auth', () => {
    expect(fromCurl(`curl http://x -u 'me:secret'`)?.auth).toEqual({ mode: 'basic', username: 'me', password: 'secret' })
  })

  it('accepts --header=value as well as --header value', () => {
    expect(fromCurl(`curl http://x --header='A: b'`)?.headers).toEqual([{ name: 'A', value: 'b', enabled: true }])
  })

  it('skips flags it does not understand without eating the URL', () => {
    expect(fromCurl(`curl -L --compressed -k http://x`)?.url).toBe('http://x')
  })

  it('concatenates repeated -d the way curl does', () => {
    expect(fromCurl(`curl http://x -d a=1 -d b=2`)?.body).toBe('a=1&b=2')
  })

  it('detects a form body from the content-type and stores it as key/value JSON', () => {
    const parsed = fromCurl(`curl http://x -H 'Content-Type: application/x-www-form-urlencoded' -d 'a=1&b=2'`)
    expect(parsed?.bodyMode).toBe('form')
    expect(JSON.parse(parsed?.body ?? '[]')).toEqual([
      { name: 'a', value: '1', enabled: true },
      { name: 'b', value: '2', enabled: true },
    ])
  })

  it('maps -A, -b and -e onto their headers', () => {
    const parsed = fromCurl(`curl http://x -A ua -b 'k=v' -e http://ref`)
    expect(parsed?.headers.map((h) => h.name)).toEqual(['User-Agent', 'Cookie', 'Referer'])
  })
})

describe('toCurl', () => {
  const req = {
    method: 'POST',
    url: 'http://x/y',
    headers: [
      { name: 'Accept', value: 'application/json', enabled: true },
      { name: 'X-Off', value: 'no', enabled: false },
    ],
    bodyMode: 'json' as const,
    body: '{"a":1}',
    auth: { mode: 'bearer' as const, token: 'tok' },
  }

  it('emits method, enabled headers, resolved auth and the body', () => {
    const out = toCurl(req)
    expect(out).toContain('curl -X POST http://x/y')
    expect(out).toContain(`-H 'Accept: application/json'`)
    expect(out).toContain(`-H 'Authorization: Bearer tok'`)
    expect(out).toContain(`-d '{"a":1}'`)
    expect(out).not.toContain('X-Off')
  })

  it('appends a query-placement api key to the URL', () => {
    const out = toCurl({ ...req, auth: { mode: 'apikey', key: 'k', value: 'v', placement: 'query' } })
    expect(out).toContain('http://x/y?k=v')
  })

  it('round-trips through fromCurl', () => {
    const parsed = fromCurl(toCurl(req))
    expect(parsed).toMatchObject({ method: 'POST', url: 'http://x/y', body: '{"a":1}' })
    // Auth was compiled into a header on the way out, so it comes back as a header, not as auth.
    expect(parsed?.headers.find((h) => h.name === 'Authorization')?.value).toBe('Bearer tok')
  })

  it('quotes a URL containing shell metacharacters', () => {
    expect(toCurl({ ...req, url: 'http://x/y?a=1&b=2' })).toContain(`'http://x/y?a=1&b=2'`)
  })
})

describe('serializeBody', () => {
  it('returns undefined when there is nothing to send', () => {
    expect(serializeBody('none', '{"a":1}')).toBeUndefined()
    expect(serializeBody('json', '')).toBeUndefined()
  })

  it('passes json and text through untouched', () => {
    expect(serializeBody('json', '{"a":1}')).toBe('{"a":1}')
  })

  it('url-encodes a form body and drops disabled rows', () => {
    const body = JSON.stringify([
      { name: 'a', value: '1 2', enabled: true },
      { name: 'b', value: 'x', enabled: false },
    ])
    expect(serializeBody('form', body)).toBe('a=1%202')
  })

  it('survives a malformed form body rather than throwing', () => {
    expect(serializeBody('form', 'not json')).toBe('')
  })
})
