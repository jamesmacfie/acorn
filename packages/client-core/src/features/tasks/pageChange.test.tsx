import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import {
  _resetClientTelemetry,
  flushTelemetry,
  setTelemetryEnabled,
  startClientTelemetry,
} from '../../infra/telemetry/emitter'
import { _resetPageChange, markPageChange } from './pageChange'

// The `nav.change` span, in jsdom because the whole point of it is when it ends: on the second
// animation frame after the signal was written, which is the first frame with the new content in
// it. A bare-Node suite has no frames, so this test cannot live beside the logic ones.

let posted: TelemetryRecord[]
const spans = () => posted.filter((record) => record.kind === 'span' && record.name === 'nav.change')

/** Two frames, plus the microtask turn the flush takes. */
const settle = async (frames = 2): Promise<void> => {
  for (let index = 0; index < frames; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  await flushTelemetry()
}

beforeEach(() => {
  _resetClientTelemetry()
  _resetPageChange()
  posted = []
  startClientTelemetry({ runtime: 'renderer', post: async (records) => void posted.push(...records) })
  setTelemetryEnabled(true)
})
afterEach(() => {
  _resetClientTelemetry()
  _resetPageChange()
})

describe('a page change', () => {
  it('ends on the second animation frame and not before', async () => {
    markPageChange('core', { to: 'task', 'task.id': 't1' })
    await settle(1)
    // One frame in, the browser has painted what it was already going to paint. The new content is
    // not on screen yet.
    expect(spans()).toEqual([])
    await settle(1)
    const [span] = spans()
    expect(span?.attrs).toMatchObject({ to: 'task', 'task.id': 't1', owner: 'core', runtime: 'renderer' })
  })

  it('collapses two writes in one change into one span, with the later one winning', async () => {
    // Opening a task writes both signals: it clears the selected source, then sets the task. Two
    // spans would report the click as a navigation to nothing followed by a navigation to a task.
    markPageChange('core', { to: 'task', 'task.id': 't1' })
    markPageChange('github', { to: 'source', 'source.id': 'github.prs' })
    await settle()
    expect(spans()).toHaveLength(1)
    expect(spans()[0].attrs).toMatchObject({ to: 'source', 'source.id': 'github.prs', 'task.id': 't1' })
    // The owner is the first change's, because it is the span that was opened. A second interaction
    // opening over the first is a different case and gets its own span.
    expect(spans()[0].attrs.owner).toBe('core')
  })

  it('opens a fresh span for the next change once the first has ended', async () => {
    markPageChange('core', { to: 'task', 'task.id': 't1' })
    await settle()
    markPageChange('core', { to: 'task', 'task.id': 't2' })
    await settle()
    expect(spans().map((span) => span.attrs['task.id'])).toEqual(['t1', 't2'])
  })

  it('builds nothing while the switch is off', async () => {
    setTelemetryEnabled(false)
    markPageChange('core', { to: 'task', 'task.id': 't1' })
    await settle()
    expect(posted).toEqual([])
  })
})
