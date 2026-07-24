import { describe, expect, it } from 'vitest'
import type { BrowserRule } from './api'
import { isValidBrowserRule, matchesUrlPattern, parseBrowserRules } from './browserRules'

const rule = (over: Partial<BrowserRule> = {}): BrowserRule => ({
  id: 'r1',
  enabled: true,
  urlPattern: 'localhost:3000/login',
  trigger: 'load',
  action: { type: 'fill', selector: 'input[type=password]', value: 'hunter2' },
  ...over,
})

describe('isValidBrowserRule', () => {
  it('accepts a well-formed fill-on-load rule', () => {
    expect(isValidBrowserRule(rule())).toBe(true)
    expect(isValidBrowserRule(rule({ action: { type: 'fill', selector: '#pw', value: '' } }))).toBe(true) // empty value is a valid fill
  })
  it('rejects malformed shapes', () => {
    expect(isValidBrowserRule(null)).toBe(false)
    expect(isValidBrowserRule('rule')).toBe(false)
    expect(isValidBrowserRule(rule({ id: '' }))).toBe(false)
    expect(isValidBrowserRule(rule({ urlPattern: '   ' }))).toBe(false)
    expect(isValidBrowserRule({ ...rule(), trigger: 'navigate' })).toBe(false)
    expect(isValidBrowserRule({ ...rule(), action: { type: 'click', selector: '#x' } })).toBe(false)
    expect(isValidBrowserRule(rule({ action: { type: 'fill', selector: ' ', value: 'x' } }))).toBe(false)
    expect(isValidBrowserRule({ ...rule(), enabled: 'yes' })).toBe(false)
  })
})

describe('parseBrowserRules', () => {
  it('parses a stored array and filters invalid entries', () => {
    const text = JSON.stringify([rule(), { junk: true }, rule({ id: 'r2' })])
    expect(parseBrowserRules(text).map((r) => r.id)).toEqual(['r1', 'r2'])
  })
  it('degrades to [] on null, garbage, and non-array JSON', () => {
    expect(parseBrowserRules(null)).toEqual([])
    expect(parseBrowserRules('')).toEqual([])
    expect(parseBrowserRules('not json {')).toEqual([])
    expect(parseBrowserRules('{"a":1}')).toEqual([])
  })
})

describe('matchesUrlPattern', () => {
  it('matches by substring without wildcards', () => {
    expect(matchesUrlPattern('http://localhost:3000/login?next=/', 'localhost:3000/login')).toBe(true)
    expect(matchesUrlPattern('http://localhost:3000/home', 'localhost:3000/login')).toBe(false)
  })
  it('treats * as a wildcard and escapes regex metachars', () => {
    expect(matchesUrlPattern('http://localhost:3000/app/users/42/edit', 'localhost:3000/*/edit')).toBe(true)
    expect(matchesUrlPattern('http://localhost:3000/app', 'localhost:3000/*/edit')).toBe(false)
    expect(matchesUrlPattern('http://app.test/a.b/x', 'a.b')).toBe(true)
    expect(matchesUrlPattern('http://app.test/aXb/x', 'a.b')).toBe(false) // '.' is literal, not regex
  })
  it('never matches a blank pattern', () => {
    expect(matchesUrlPattern('http://localhost:3000/', '')).toBe(false)
    expect(matchesUrlPattern('http://localhost:3000/', '   ')).toBe(false)
  })
})
