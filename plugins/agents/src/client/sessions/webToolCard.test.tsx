import { render } from 'solid-js/web'
import { afterEach, expect, it } from 'vitest'
import type { AgentWebActivity } from '@acorn/protocol/managedAgents.ts'
import { WebToolBody, safeWebUrl, webSummary } from './webToolCard'

// The one card both providers land on. Every case here is written against a normalized payload and
// none of them names a harness, which is the property the card exists to hold: a driver earns this
// drawing by filling in `AgentToolCall.web` and nothing else.

const hosts: Array<() => void> = []
afterEach(() => { for (const dispose of hosts.splice(0).reverse()) dispose() })

const draw = (web: AgentWebActivity, output?: string) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <WebToolBody web={web} output={output} />, host)
  hosts.push(() => { dispose(); host.remove() })
  return host
}

const links = (host: HTMLElement) => Array.from(host.querySelectorAll('a')).map((anchor) => ({
  href: anchor.getAttribute('href'),
  text: anchor.textContent,
}))

it('draws a search that has a query and nothing back yet', () => {
  const host = draw({ action: { type: 'search', queries: ['acp specification'] } })
  expect(host.textContent).toContain('acp specification')
  expect(host.textContent).not.toContain('Results')
  expect(links(host)).toEqual([])
})

it('draws every query and both kinds of domain filter', () => {
  const host = draw({
    action: {
      type: 'search',
      queries: ['first query', 'second query'],
      allowedDomains: ['docs.example'],
      blockedDomains: ['ads.example'],
    },
  })
  expect(host.textContent).toContain('first query')
  expect(host.textContent).toContain('second query')
  expect(host.textContent).toContain('allowed: docs.example')
  expect(host.textContent).toContain('blocked: ads.example')
})

it('draws the page of an open, a find and a fetch', () => {
  expect(draw({ action: { type: 'open_page', url: 'https://example.com/page' } }).textContent)
    .toContain('https://example.com/page')
  const find = draw({ action: { type: 'find_in_page', url: 'https://example.com/page', pattern: 'session' } })
  expect(find.textContent).toContain('session')
  const fetched = draw({ action: { type: 'fetch_page', url: 'https://example.com/page', prompt: 'what is a session' } })
  expect(fetched.textContent).toContain('what is a session')
})

it('draws a source as a link, its host, and its snippet', () => {
  const host = draw({
    action: { type: 'search', queries: ['acp'] },
    results: [{
      url: 'https://docs.example/intro',
      title: 'Introduction',
      domain: 'docs.example',
      snippet: 'A sentence from the page.',
    }],
  })
  expect(links(host)).toEqual([{ href: 'https://docs.example/intro', text: 'Introduction' }])
  expect(host.textContent).toContain('docs.example')
  expect(host.textContent).toContain('A sentence from the page.')
})

it('shows the host a provider did not report, read off the URL rather than stored', () => {
  // Codex reports a domain; Claude Code does not, and the two must still read the same.
  const host = draw({ results: [{ url: 'https://docs.example/intro', title: 'Introduction' }] })
  expect(host.textContent).toContain('docs.example')
})

it('uses the URL as the link text when a source has no title', () => {
  expect(links(draw({ results: [{ url: 'https://docs.example/intro' }] })))
    .toEqual([{ href: 'https://docs.example/intro', text: 'https://docs.example/intro' }])
})

it('keeps the provider’s own words beside the structured half', () => {
  // Claude Code's search answer, and any failed call's error, live here.
  const host = draw(
    { action: { type: 'search', queries: ['acp'] } },
    'Search failed: rate limited',
  )
  expect(host.textContent).toContain('Search failed: rate limited')
})

it('refuses every scheme but http and https, and still shows the text', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'acorn://task/1', 'not a url']) {
    expect(safeWebUrl(url), url).toBeUndefined()
    const host = draw({ results: [{ url, title: 'Looks harmless' }] })
    expect(links(host), url).toEqual([])
    // Visible, so a reader can see what the provider tried.
    expect(host.textContent, url).toContain('Looks harmless')
  }
  expect(safeWebUrl('http://example.com')).toBe('http://example.com')
  expect(safeWebUrl('https://example.com')).toBe('https://example.com')
})

it('draws nothing at all for a payload with nothing in it', () => {
  // A provider that opened a call and settled it without ever saying what it did.
  expect(draw({}).textContent).toBe('')
  expect(draw({ action: { type: 'other' } }).textContent).toBe('')
})

it('keeps the sources a provider repeated, in the order it gave them', () => {
  // The transcript records the answer; it does not rank it again or dedupe it.
  const host = draw({
    results: [
      { url: 'https://docs.example/b', title: 'Second' },
      { url: 'https://docs.example/a', title: 'First' },
      { url: 'https://docs.example/a', title: 'First again' },
    ],
  })
  expect(links(host).map((link) => link.text)).toEqual(['Second', 'First', 'First again'])
})

it('summarises a row by its first query, its page host, or its pattern', () => {
  expect(webSummary({ action: { type: 'search', queries: ['first', 'second'] } })).toBe('first')
  expect(webSummary({ action: { type: 'open_page', url: 'https://docs.example/a/very/long/path' } })).toBe('docs.example')
  expect(webSummary({ action: { type: 'find_in_page', pattern: 'session' } })).toBe('session')
  expect(webSummary({ action: { type: 'other' } })).toBeUndefined()
  expect(webSummary({ results: [{ url: 'https://docs.example' }] })).toBeUndefined()
  // A URL the card would refuse to link is still what the call was about, so it still says so.
  expect(webSummary({ action: { type: 'open_page', url: 'not a url' } })).toBe('not a url')
})
