import { describe, expect, it } from 'vitest'
import { CAPS, composeItemDetail, normalizeItemMetadata, normalizeOccurrence, normalizeSummary, occurrenceSummary } from './normalize'
import type { RollbarApiInstance } from './'
import { CRASH_INSTANCE, ITEM, MESSAGE_INSTANCE, SPARSE_ITEM, TRACE_CHAIN_INSTANCE, TRACE_INSTANCE, UNKNOWN_INSTANCE } from './__fixtures__/occurrences'

describe('rollbar normalizer', () => {
  it('numeric and string levels normalise to words', () => {
    expect(normalizeSummary('c', 'L', ITEM).level).toBe('error')
    expect(normalizeSummary('c', 'L', SPARSE_ITEM).level).toBe('warning')
  })

  it('summary maps counter/id and unix-seconds → ms', () => {
    const s = normalizeSummary('conn-1', 'Rollbar · acme', ITEM)
    expect(s).toMatchObject({
      integrationId: 'conn-1', integrationLabel: 'Rollbar · acme', identifier: '142', itemId: '999',
      url: 'https://rollbar.com/item/999/', framework: 'node',
    })
    expect(s.firstOccurrenceAt).toBe(1_700_000_000_000)
  })

  it('sparse item survives with safe defaults and no timestamps', () => {
    const s = normalizeSummary('c', 'L', SPARSE_ITEM)
    expect(s).toMatchObject({ identifier: '7', itemId: '12', totalOccurrences: 0, firstOccurrenceAt: null, lastOccurrenceAt: null })
    expect(s.framework).toBeUndefined()
    expect(s.lastActivatedAt).toBeUndefined()
    expect(s.uniqueOccurrences).toBeUndefined()
  })

  it('keeps regression and unique-IP fields when the plan supplies them (unix-seconds → ms)', () => {
    const s = normalizeSummary('c', 'L', ITEM)
    expect(s.lastActivatedAt).toBe(1_700_050_000_000)
    expect(s.uniqueOccurrences).toBe(12)
  })

  it('occurrence summary carries the scannable facts but flattens person to a username', () => {
    const summary = occurrenceSummary(normalizeOccurrence(TRACE_INSTANCE))
    expect(summary).toMatchObject({
      environment: 'prod', codeVersion: 'aabbcc1', personUsername: 'jo',
      request: { method: 'POST', url: '/api/login' },
    })
    expect(JSON.stringify(summary)).not.toContain('jo@example.test')
  })

  it('canonical data envelope: exception + ordered frames + bounded code context', () => {
    const occ = normalizeOccurrence(TRACE_INSTANCE)
    expect(occ.kind).toBe('trace')
    expect(occ.url).toBe('https://rollbar.com/occurrence/uuid/?uuid=aaaa-bbbb')
    expect(occ.exceptionClass).toBe('TypeError')
    expect(occ.frames.map((f) => f.filename)).toEqual(['auth/session.ts', 'api/login.ts'])
    expect(occ.frames[0].inProject).toBe(true)
    expect(occ.frames[0].code.length).toBeLessThanOrEqual(CAPS.codeLinesPerFrame)
    // anchored around the offending line
    expect(occ.frames[0].code.some((c) => c.line === 84 && c.text === 'return s.token')).toBe(true)
  })

  it('trace-chain keeps inner+outer, message uses body, crash/unknown degrade', () => {
    // These fixtures retain the legacy `occurrence` alias, proving both envelopes normalize.
    expect(normalizeOccurrence(TRACE_CHAIN_INSTANCE).kind).toBe('trace-chain')
    expect(normalizeOccurrence(TRACE_CHAIN_INSTANCE).frames).toHaveLength(2)
    expect(normalizeOccurrence(MESSAGE_INSTANCE)).toMatchObject({ kind: 'message', message: 'disk almost full' })
    expect(normalizeOccurrence(CRASH_INSTANCE).kind).toBe('crash-report')
    expect(normalizeOccurrence(UNKNOWN_INSTANCE).kind).toBe('unknown')
  })

  it('drops raw request headers/body, cookies, and crash raw — allowlist only', () => {
    const occ = normalizeOccurrence(TRACE_INSTANCE)
    const json = JSON.stringify(occ)
    expect(json).not.toContain('SECRET')
    expect(json).not.toContain('authorization')
    expect(occ.request).toEqual({ method: 'POST', url: '/api/login' })
    expect(occ.environment).toBe('prod')
    expect(JSON.stringify(normalizeOccurrence(CRASH_INSTANCE))).not.toContain('SHOULD NOT SURVIVE')
  })

  it('caps a huge trace and marks it truncated', () => {
    const frames = Array.from({ length: 500 }, (_, i) => ({ filename: `f${i}.ts`, lineno: i }))
    const big: RollbarApiInstance = { id: 1, occurrence: { body: { trace: { exception: { class: 'E', message: 'm' }, frames } } } }
    const occ = normalizeOccurrence(big)
    expect(occ.frames).toHaveLength(CAPS.framesTotal)
    expect(occ.truncated).toBe(true)
  })

  it('long strings are byte-capped', () => {
    const huge = 'x'.repeat(CAPS.maxStringBytes + 5000)
    const occ = normalizeOccurrence({ id: 1, occurrence: { body: { message: { body: huge } } } })
    expect(Buffer.byteLength(occ.message ?? '', 'utf8')).toBeLessThanOrEqual(CAPS.maxStringBytes + 4)
  })

  it('strips control characters from displayed text', () => {
    const occ = normalizeOccurrence({ id: 1, occurrence: { body: { message: { body: 'a\u0000b\u0007c' } } } })
    expect(occ.message).toBe('abc')
  })

  it('detail carries the stable Rollbar item permalink', () => {
    const summary = normalizeSummary('c', 'L', ITEM)
    const detail = composeItemDetail(normalizeItemMetadata(summary, ITEM), normalizeOccurrence(TRACE_INSTANCE))
    expect(detail).toMatchObject({ identifier: '142', resolvedInVersion: null, assignedTo: null, url: 'https://rollbar.com/item/999/' })
    expect(detail.latestOccurrence?.exceptionClass).toBe('TypeError')
  })

  it('drops email first, then frames, to stay under the byte target', () => {
    const frames = Array.from({ length: 200 }, (_, i) => ({ filename: `frame-${i}.ts`, lineno: i, code: 'x'.repeat(2000) }))
    const inst: RollbarApiInstance = {
      id: 1,
      occurrence: { person: { email: 'a@b.test' }, body: { trace: { exception: { class: 'E', message: 'm' }, frames } } },
    }
    const detail = composeItemDetail(normalizeItemMetadata(normalizeSummary('c', 'L', ITEM), ITEM), normalizeOccurrence(inst))
    expect(Buffer.byteLength(JSON.stringify(detail.latestOccurrence), 'utf8')).toBeLessThanOrEqual(CAPS.maxDetailBytes)
    expect(detail.latestOccurrence?.person?.email).toBeNull()
    expect(detail.latestOccurrence?.truncated).toBe(true)
  })
})
