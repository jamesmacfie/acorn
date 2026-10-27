import { describe, expect, it } from 'vitest'
import { CAPS, composeIssueDetail, normalizeEvent, normalizeIssue } from './normalize'

const frame = (n: number, extra: Record<string, unknown> = {}) => ({
  filename: `src/f${n}.ts`,
  lineNo: 10,
  colNo: 2,
  function: `fn${n}`,
  inApp: true,
  context: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((line) => [line, `line ${line}`]),
  vars: { password: 'hunter2' },
  ...extra,
})

const exceptionEvent = (values: unknown[], extra: Record<string, unknown> = {}) => ({
  eventID: 'e1',
  dateCreated: '2026-10-26T01:02:03Z',
  entries: [{ type: 'exception', data: { values } }],
  tags: [
    { key: 'environment', value: 'production' },
    { key: 'user.email', value: 'someone@example.com' },
  ],
  release: { version: 'web@1.2.3' },
  user: { email: 'someone@example.com', ip_address: '10.0.0.1' },
  ...extra,
})

describe('normalizeIssue', () => {
  it('keeps the allowlisted fields and turns counts and times into numbers', () => {
    expect(
      normalizeIssue('c1', 'Sentry · acme/web', {
        id: '42',
        shortId: 'WEB-1',
        title: 'TypeError\u0000 boom',
        culprit: 'app/checkout',
        level: 'error',
        status: 'unresolved',
        count: '1234',
        userCount: 7,
        firstSeen: '2026-10-01T00:00:00Z',
        lastSeen: '2026-10-26T00:00:00Z',
        permalink: 'https://acme.sentry.io/issues/42/',
        assignedTo: { email: 'someone@example.com' },
      }),
    ).toEqual({
      connectionId: 'c1',
      connectionLabel: 'Sentry · acme/web',
      id: '42',
      shortId: 'WEB-1',
      title: 'TypeError boom',
      culprit: 'app/checkout',
      level: 'error',
      status: 'unresolved',
      count: 1234,
      userCount: 7,
      firstSeen: Date.parse('2026-10-01T00:00:00Z'),
      lastSeen: Date.parse('2026-10-26T00:00:00Z'),
      url: 'https://acme.sentry.io/issues/42/',
    })
  })

  it('keeps only an https permalink', () => {
    expect(normalizeIssue('c1', 'label', { id: '1', permalink: 'javascript:alert(1)' })?.url).toBeNull()
  })

  it('drops an issue with no id', () => {
    expect(normalizeIssue('c1', 'label', { title: 'no id' })).toBeNull()
  })
})

describe('normalizeEvent', () => {
  it('reads the raised exception first and the call that threw at the top', () => {
    const event = normalizeEvent(
      exceptionEvent([
        { type: 'Cause', value: 'inner', stacktrace: { frames: [frame(1)] } },
        { type: 'TypeError', value: 'outer', stacktrace: { frames: [frame(2), frame(3)] } },
      ]),
    )
    expect(event).toMatchObject({
      id: 'e1',
      exceptionType: 'TypeError',
      message: 'outer',
      environment: 'production',
      release: 'web@1.2.3',
      truncated: false,
    })
    expect(event.frames.map((f) => f.method)).toEqual(['fn3', 'fn2', 'fn1'])
  })

  it('never carries the user, other tags, or frame variables', () => {
    const text = JSON.stringify(normalizeEvent(exceptionEvent([{ type: 'E', stacktrace: { frames: [frame(1)] } }])))
    expect(text).not.toContain('someone@example.com')
    expect(text).not.toContain('10.0.0.1')
    expect(text).not.toContain('hunter2')
  })

  it('keeps a window of source lines around the line that ran', () => {
    const [first] = normalizeEvent(exceptionEvent([{ stacktrace: { frames: [frame(1)] } }])).frames
    expect(first!.code).toHaveLength(CAPS.codeLinesPerFrame)
    expect(first!.code.map((line) => line.line)).toEqual([7, 8, 9, 10, 11, 12, 13])
  })

  it('caps the chain, the frames, and each string, and says so', () => {
    const many = Array.from({ length: CAPS.exceptions + 2 }, (_, i) => ({
      type: `E${i}`,
      stacktrace: { frames: Array.from({ length: 30 }, (_, n) => frame(n)) },
    }))
    const event = normalizeEvent(exceptionEvent(many))
    expect(event.frames).toHaveLength(CAPS.framesTotal)
    expect(event.truncated).toBe(true)

    const long = normalizeEvent(exceptionEvent([{ type: 'E', value: 'x'.repeat(CAPS.maxStringBytes * 2) }]))
    expect(Buffer.byteLength(long.message!, 'utf8')).toBeLessThanOrEqual(CAPS.maxStringBytes + 3)
  })

  it('reads a message event', () => {
    expect(
      normalizeEvent({ entries: [{ type: 'message', data: { formatted: 'disk full' } }], release: 'web@1' }),
    ).toMatchObject({ message: 'disk full', release: 'web@1', frames: [] })
  })
})

describe('composeIssueDetail', () => {
  it('halves the stack until the whole detail fits', () => {
    const issue = normalizeIssue('c1', 'label', { id: '1' })!
    const huge = 'y'.repeat(CAPS.maxStringBytes)
    const event = normalizeEvent(
      exceptionEvent([
        {
          type: 'E',
          stacktrace: {
            frames: Array.from({ length: CAPS.framesTotal }, (_, n) =>
              frame(n, { context: [[10, huge]], filename: huge }),
            ),
          },
        },
      ]),
    )
    const detail = composeIssueDetail(issue, event)
    expect(Buffer.byteLength(JSON.stringify(detail.latestEvent), 'utf8')).toBeLessThanOrEqual(CAPS.maxDetailBytes)
    expect(detail.latestEvent!.frames.length).toBeGreaterThan(0)
    expect(detail.latestEvent!.truncated).toBe(true)
  })
})
