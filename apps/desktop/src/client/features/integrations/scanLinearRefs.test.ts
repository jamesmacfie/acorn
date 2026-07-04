import { describe, expect, it } from 'vitest'
import { scanLinearRefs } from './scanLinearRefs'

describe('scanLinearRefs', () => {
  it('matches linear.app issue URLs and ignores bare identifiers', () => {
    const refs = scanLinearRefs([
      'Fixes <a href="https://linear.app/acme/issue/ENG-123/fix-login">ENG-123</a>',
      'see ENG-456 (no link) and HTTP-200',
    ])
    expect(refs).toEqual([{ identifier: 'ENG-123', url: 'https://linear.app/acme/issue/ENG-123' }])
  })

  it('dedupes across texts, first occurrence wins, preserves order', () => {
    const refs = scanLinearRefs([
      'https://linear.app/acme/issue/ENG-1 https://linear.app/acme/issue/ABC-9',
      'https://linear.app/acme/issue/ENG-1/again',
      null,
    ])
    expect(refs.map((r) => r.identifier)).toEqual(['ENG-1', 'ABC-9'])
  })
})
