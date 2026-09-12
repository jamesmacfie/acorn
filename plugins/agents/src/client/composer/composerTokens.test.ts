import { describe, expect, it } from 'vitest'
import { parseFileMentions } from './fileMentions'
import {
  advertisedSuggestions,
  composerSegments,
  composerTokens,
  MAX_HIGHLIGHT_LENGTH,
  type ComposerToken,
} from './composerTokens'

const advertised = { commands: ['review', 'compact'], skills: ['readable', 'code-review:codex'] }
const spans = (text: string, tokens: ComposerToken[]) =>
  tokens.map((token) => `${token.kind}:${text.slice(token.start, token.end)}`)

describe('composerTokens', () => {
  it('colours an advertised command and skill, and leaves an unknown one alone', () => {
    const text = 'run /review then $readable, not /reviw or $nope'
    expect(spans(text, composerTokens(text, advertised))).toEqual(['command:/review', 'skill:$readable'])
  })

  it('keeps prose that merely contains a slash as prose', () => {
    for (const text of ['shipped 9/11 and/or later', 'see http://example.com/review']) {
      expect(composerTokens(text, advertised)).toEqual([])
    }
  })

  it('colours a namespaced skill', () => {
    const text = 'try $code-review:codex here'
    expect(spans(text, composerTokens(text, advertised))).toEqual(['skill:$code-review:codex'])
  })

  it('colours exactly the file mentions the turn sends as file parts', () => {
    const text = 'read @src/app.ts:12-20 and @"a b/c.ts", not @not-an-email@example.com or @/etc/passwd'
    const tokens = composerTokens(text, advertised)
    expect(spans(text, tokens)).toEqual([
      'file:@src/app.ts:12-20',
      'file:@"a b/c.ts"',
      'file:@not-an-email@example.com',
    ])
    // The highlighter and the sender agree on what counts, which is the point of sharing the walk.
    expect(parseFileMentions(text).map((part) => part.path)).toEqual([
      'src/app.ts',
      'a b/c.ts',
      'not-an-email@example.com',
    ])
  })

  it('leaves trailing sentence punctuation outside the span', () => {
    const text = 'open @src/app.ts.'
    expect(spans(text, composerTokens(text, advertised))).toEqual(['file:@src/app.ts'])
  })

  it('gives up on a draft too long to mirror', () => {
    expect(composerTokens(`/review ${'x'.repeat(MAX_HIGHLIGHT_LENGTH)}`, advertised)).toEqual([])
  })
})

describe('composerSegments', () => {
  it('rebuilds the draft exactly, so the mirror cannot drift from the textarea', () => {
    const text = 'run /review on @src/app.ts\nthen $readable it'
    expect(composerSegments(text, advertised).map((segment) => segment.text).join('')).toBe(`${text}\n`)
  })

  it('marks only the token pieces, and carries the name a tooltip is keyed by', () => {
    const text = 'a /review b'
    expect(composerSegments(text, advertised)).toEqual([
      { text: 'a ', token: null },
      { text: '/review', token: { kind: 'command', name: 'review', start: 2, end: 9 } },
      { text: ' b\n', token: null },
    ])
  })

  it('ends with a newline even when the draft is empty, keeping the first row aligned', () => {
    expect(composerSegments('', advertised)).toEqual([{ text: '\n', token: null }])
  })
})

describe('advertisedSuggestions', () => {
  const items = [
    { name: 'review', description: 'Review the working tree' },
    { name: 'compact', description: 'Summarise the transcript' },
    { name: 'commit', description: 'Write a commit message' },
  ]

  it('offers everything for an empty query, so `/` alone lists the commands', () => {
    expect(advertisedSuggestions(items, '').map((item) => item.name)).toEqual(['review', 'compact', 'commit'])
  })

  it('matches on the name', () => {
    expect(advertisedSuggestions(items, 'comm').map((item) => item.name)).toEqual(['commit'])
    expect(advertisedSuggestions(items, 'com').map((item) => item.name).sort())
      .toEqual(['commit', 'compact'])
  })

  it('keeps a match that only the description makes, ranked below the name matches', () => {
    expect(advertisedSuggestions(items, 'working tree').map((item) => item.name)).toEqual(['review'])
    expect(advertisedSuggestions(items, 'commit').map((item) => item.name)).toEqual(['commit'])
  })

  it('caps the list', () => {
    expect(advertisedSuggestions(items, '', 2)).toHaveLength(2)
  })
})
