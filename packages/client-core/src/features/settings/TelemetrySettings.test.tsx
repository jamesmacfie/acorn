import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetrySummary } from '@acorn/protocol/api.ts'

// The page is the only place a person can answer "what is this app sending", so the two things
// worth pinning are that the switch writes the node preference and that the counters are drawn from
// the node rather than invented (docs/telemetry.md § What the page shows).
//
// The two queries are told apart by the marker each mocked options factory returns, because the
// page asks for both and a single stub would answer the wrong one for the other.
const mocks = vi.hoisted(() => ({
  prefs: { data: {} as Record<string, string> },
  summary: { data: undefined as TelemetrySummary | undefined },
  saveTelemetryOn: vi.fn(),
}))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { of: string }) => (options().of === 'prefs' ? mocks.prefs : mocks.summary),
  useQueryClient: () => ({}),
}))
vi.mock('../../infra/queries', () => ({
  prefsOptions: () => ({ of: 'prefs' }),
  telemetrySummaryOptions: () => ({ of: 'summary' }),
}))
vi.mock('./telemetrySetting', () => ({
  telemetryOn: (prefs: Record<string, string> | undefined) => prefs?.['telemetry.enabled'] === '1',
  saveTelemetryOn: mocks.saveTelemetryOn,
}))

import TelemetrySettings from './TelemetrySettings'

const SUMMARY: TelemetrySummary = {
  enabled: true,
  collecting: true,
  since: Date.now() - 60_000,
  lastFlushAt: Date.now() - 2_000,
  dropped: 0,
  truncated: 0,
  sinks: ['sentry-telemetry'],
  records: [
    { owner: 'core', kind: 'span', count: 412 },
    { owner: 'github', kind: 'metric', count: 40 },
  ],
}

let host: HTMLElement
let dispose: () => void

const mount = () => {
  dispose?.()
  dispose = render(() => <TelemetrySettings />, host)
}

beforeEach(() => {
  mocks.prefs.data = { 'telemetry.enabled': '1' }
  mocks.summary.data = SUMMARY
  mocks.saveTelemetryOn.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  mount()
})

afterEach(() => {
  dispose()
  host.remove()
})

describe('Settings → Telemetry', () => {
  it('draws the switch from the node preference and writes it back', () => {
    const box = host.querySelector<HTMLInputElement>('input[type=checkbox]')!
    expect(box.checked).toBe(true)
    box.checked = false
    box.dispatchEvent(new Event('change', { bubbles: true }))
    expect(mocks.saveTelemetryOn).toHaveBeenCalledWith(expect.anything(), false)
  })

  it('shows what has been collected, per owner and kind, and who is reading it', () => {
    const text = host.textContent ?? ''
    expect(text).toContain('built 452 records so far')
    expect(text).toContain('core')
    expect(text).toContain('github')
    expect(text).toContain('412')
    expect(text).toContain('Read by: sentry-telemetry')
  })

  it('says nothing is collected when no plugin is reading, even with the switch on', () => {
    // The half of the story a checkbox cannot tell: on plus no sink is still nothing collected,
    // which is what makes "nothing leaves this machine" true by construction.
    mocks.summary.data = { ...SUMMARY, collecting: false, sinks: [], records: [] }
    mount()
    const text = host.textContent ?? ''
    expect(text).toContain('Nothing is being collected')
    expect(text).toContain('no plugin has asked to read the stream')
    expect(text).toContain('Read by: nobody')
  })

  it('waits for the node rather than drawing zeros', () => {
    mocks.summary.data = undefined
    mount()
    expect(host.textContent).toContain('Asking the node')
  })
})
