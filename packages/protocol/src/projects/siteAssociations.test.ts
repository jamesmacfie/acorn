import { describe, expect, it } from 'vitest'
import {
  SITE_ASSOCIATIONS_MAX,
  associationMatches,
  matchingSiteProjects,
  parseSiteAddress,
  parseSiteAssociation,
  siteAssociationsSchema,
  siteMatches,
} from './siteAssociations.ts'

describe('parseSiteAddress', () => {
  it('splits an address into its origin and path prefix', () => {
    expect(parseSiteAddress(' https://Example.com/Docs/?q=1#top ')).toEqual({
      ok: true,
      site: { origin: 'https://example.com', pathPrefix: '/Docs' },
    })
    expect(parseSiteAddress('http://localhost:5173')).toEqual({
      ok: true,
      site: { origin: 'http://localhost:5173', pathPrefix: '/' },
    })
    expect(parseSiteAddress('https://example.com:443/a')).toEqual({
      ok: true,
      site: { origin: 'https://example.com', pathPrefix: '/a' },
    })
  })

  it('refuses other schemes, credentials, and non-addresses', () => {
    expect(parseSiteAddress('ftp://example.com').ok).toBe(false)
    expect(parseSiteAddress('localhost:5173').ok).toBe(false)
    expect(parseSiteAddress('example.com').ok).toBe(false)
    expect(parseSiteAddress('https://user:secret@example.com').ok).toBe(false)
    expect(parseSiteAddress('https://user@example.com').ok).toBe(false)
  })
})

describe('parseSiteAssociation', () => {
  it('reads each kind into its own shape', () => {
    expect(parseSiteAssociation('domain', ' *.Example.com ')).toEqual({ ok: true, site: { domain: 'example.com' } })
    expect(parseSiteAssociation('domain', 'https://app.example.com/a?b')).toEqual({
      ok: true,
      site: { domain: 'app.example.com' },
    })
    expect(parseSiteAssociation('prefix', 'https://example.com/a/')).toEqual({
      ok: true,
      site: { origin: 'https://example.com', pathPrefix: '/a' },
    })
    expect(parseSiteAssociation('exact', 'https://Example.com/a/?b#c')).toEqual({
      ok: true,
      site: { exact: 'https://example.com/a' },
    })
    expect(parseSiteAssociation('regex', ' ^https://[^/]+\\.example\\.com/ ')).toEqual({
      ok: true,
      site: { regex: '^https://[^/]+\\.example\\.com/' },
    })
  })

  it('refuses what a kind cannot hold', () => {
    expect(parseSiteAssociation('domain', '').ok).toBe(false)
    expect(parseSiteAssociation('domain', 'not a domain').ok).toBe(false)
    expect(parseSiteAssociation('exact', 'example.com').ok).toBe(false)
    expect(parseSiteAssociation('regex', '(').ok).toBe(false)
    expect(parseSiteAssociation('regex', 'a'.repeat(501)).ok).toBe(false)
  })
})

describe('siteAssociationsSchema', () => {
  it('accepts only the canonical form', () => {
    expect(siteAssociationsSchema.safeParse([{ origin: 'https://example.com', pathPrefix: '/a' }]).success).toBe(true)
    expect(
      siteAssociationsSchema.safeParse([
        { domain: 'example.com' },
        { exact: 'https://example.com/' },
        { regex: 'example' },
      ]).success,
    ).toBe(true)
    for (const site of [
      { domain: 'Example.com' },
      { domain: 'https://example.com' },
      { exact: 'https://example.com/a/' },
      { exact: 'https://example.com/a?b' },
      { regex: '(' },
      { domain: 'example.com', regex: 'x' },
      { origin: 'https://Example.com', pathPrefix: '/' },
      { origin: 'https://example.com/', pathPrefix: '/' },
      { origin: 'https://example.com', pathPrefix: '/a/' },
      { origin: 'https://example.com', pathPrefix: '/a?b' },
      { origin: 'https://example.com', pathPrefix: 'a' },
      { origin: 'https://u@example.com', pathPrefix: '/' },
      { origin: 'file:///tmp', pathPrefix: '/' },
      { origin: 'https://example.com:443', pathPrefix: '/' },
    ])
      expect(siteAssociationsSchema.safeParse([site]).success, JSON.stringify(site)).toBe(false)
  })

  it('bounds the list', () => {
    const many = Array.from({ length: SITE_ASSOCIATIONS_MAX + 1 }, (_, index) => ({
      origin: 'https://example.com',
      pathPrefix: `/p${index}`,
    }))
    expect(siteAssociationsSchema.safeParse(many).success).toBe(false)
    expect(siteAssociationsSchema.safeParse(many.slice(1)).success).toBe(true)
  })
})

describe('siteMatches', () => {
  const docs = { origin: 'https://example.com', pathPrefix: '/docs' }

  it('matches whole path segments under the prefix', () => {
    expect(siteMatches(docs, 'https://example.com/docs')).toBe(true)
    expect(siteMatches(docs, 'https://example.com/docs/')).toBe(true)
    expect(siteMatches(docs, 'https://example.com/docs/intro?x=1')).toBe(true)
    expect(siteMatches(docs, 'https://example.com/docsearch')).toBe(false)
    expect(siteMatches(docs, 'https://example.com/')).toBe(false)
  })

  it('needs the exact origin, port and scheme included', () => {
    const local = { origin: 'http://localhost:5173', pathPrefix: '/' }
    expect(siteMatches(local, 'http://localhost:5173/admin')).toBe(true)
    expect(siteMatches(local, 'http://localhost:5174/admin')).toBe(false)
    expect(siteMatches(local, 'https://localhost:5173/')).toBe(false)
    expect(siteMatches(docs, 'https://www.example.com/docs')).toBe(false)
    expect(siteMatches(docs, 'not an address')).toBe(false)
  })
})

describe('associationMatches', () => {
  it('covers a domain and its subdomains on any scheme and port', () => {
    const site = { domain: 'example.com' }
    expect(associationMatches(site, 'https://example.com/a')).toBe(true)
    expect(associationMatches(site, 'http://app.example.com:8080/')).toBe(true)
    expect(associationMatches(site, 'https://badexample.com/')).toBe(false)
    expect(associationMatches(site, 'https://example.com.evil.test/')).toBe(false)
  })

  it('covers one exact page, whatever its query', () => {
    const site = { exact: 'https://example.com/a' }
    expect(associationMatches(site, 'https://example.com/a/?b=1#c')).toBe(true)
    expect(associationMatches(site, 'https://example.com/a/b')).toBe(false)
  })

  it('tests a pattern against the whole address', () => {
    const site = { regex: '/pull/\\d+' }
    expect(associationMatches(site, 'https://github.com/acme/runn/pull/482')).toBe(true)
    expect(associationMatches(site, 'https://github.com/acme/runn/issues/482')).toBe(false)
  })
})

describe('matchingSiteProjects', () => {
  const sites = [
    { projectId: 'web', origin: 'https://example.com', pathPrefix: '/app' },
    { projectId: 'docs', origin: 'https://example.com', pathPrefix: '/docs' },
    { projectId: 'all', origin: 'https://example.com', pathPrefix: '/' },
    { projectId: 'web', origin: 'https://example.com', pathPrefix: '/app/admin' },
  ]

  it('lists every project whose association covers the page, once each', () => {
    expect(matchingSiteProjects(sites, 'https://example.com/app/admin/users')).toEqual(['web', 'all'])
    expect(matchingSiteProjects(sites, 'https://example.com/docs/a')).toEqual(['docs', 'all'])
    expect(matchingSiteProjects(sites, 'https://example.org/')).toEqual([])
    expect(matchingSiteProjects(sites, undefined)).toEqual([])
  })
})
