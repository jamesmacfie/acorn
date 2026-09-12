import { describe, expect, it } from 'vitest'
import {
  boundSessionTitlePrompt,
  buildSessionTitlePrompt,
  deterministicSessionTitle,
  generationText,
  isSessionTitlePromptEligible,
  normalizeGeneratedSessionTitle,
} from './sessionTitle'

describe('managed session title rules', () => {
  it('requires five normalized words for generation', () => {
    expect(isSessionTitlePromptEligible('one two three four')).toBe(false)
    expect(isSessionTitlePromptEligible(' one\n two\tthree  four five ')).toBe(true)
  })

  it('uses only effective text parts for generation', () => {
    const text = generationText([
      { type: 'file', path: 'secret.ts' },
      { type: 'text', text: 'rewritten by the hook' },
      { type: 'context', contextId: 'c', label: 'private', content: 'hidden', source: 'test', capturedAt: 1 },
      { type: 'text', text: 'with the accepted ending' },
    ])
    expect(text).toBe('rewritten by the hook\nwith the accepted ending')
    expect(buildSessionTitlePrompt(text)).toBe(`First user request:\n${text}`)
  })

  it('bounds long prompts while preserving their ending', () => {
    expect(boundSessionTitlePrompt('a'.repeat(8_000))).toHaveLength(8_000)
    const bounded = boundSessionTitlePrompt(`${'a'.repeat(8_000)}${'z'.repeat(2_100)}`)
    expect(bounded).toHaveLength(8_000)
    expect(bounded).toContain('[middle omitted]')
    expect(bounded.endsWith('z'.repeat(2_000))).toBe(true)
  })

  it('keeps the deterministic fallback behavior', () => {
    expect(deterministicSessionTitle([
      { type: 'text', text: '  ' },
      { type: 'text', text: '  Name\nthis   session  ' },
    ])).toBe('Name this session')
    expect(deterministicSessionTitle([{ type: 'attachment', attachmentId: 'a' }], 'brief.pdf')).toBe('brief.pdf')
    expect(deterministicSessionTitle([{ type: 'attachment', attachmentId: 'a' }])).toBeNull()
  })

  it.each([
    ['Fix checkout persistence', 'Fix checkout persistence'],
    ['"Fix checkout persistence"', 'Fix checkout persistence'],
    ['```text\nFix checkout persistence\n```', 'Fix checkout persistence'],
    ['### Fix checkout persistence', 'Fix checkout persistence'],
    ['Title: Fix checkout persistence.', 'Fix checkout persistence'],
    ['1. Fix checkout persistence!', 'Fix checkout persistence'],
    ['\n\nFix checkout persistence\nExplanation follows', 'Fix checkout persistence'],
  ])('normalizes %s', (answer, expected) => {
    expect(normalizeGeneratedSessionTitle(answer, 'fallback')).toBe(expected)
  })

  it('bounds words and characters and rejects no-op answers', () => {
    expect(normalizeGeneratedSessionTitle('one two three four five six seven eight nine ten', 'fallback'))
      .toBe('one two three four five six seven eight')
    expect(normalizeGeneratedSessionTitle('pneumonoultramicroscopicsilicovolcanoconiosis-and-more', 'fallback'))
      .toHaveLength(50)
    expect(normalizeGeneratedSessionTitle('', 'fallback')).toBeNull()
    expect(normalizeGeneratedSessionTitle('New agent session', 'fallback')).toBeNull()
    expect(normalizeGeneratedSessionTitle('fallback', 'fallback')).toBeNull()
  })
})
