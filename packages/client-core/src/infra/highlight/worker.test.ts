import { afterEach, expect, it, vi } from 'vitest'
import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { _resetClientTelemetry, flushTelemetry, setTelemetryEnabled, startClientTelemetry } from '../telemetry/emitter'
import { resetHighlightWorker, tokenizeDocument } from './worker'

vi.mock('./shiki', () => ({ getHighlighter: async () => ({ codeToTokensWithThemes: (text: string) => [[{ content: text, variants: { light: { color: 'black' }, dark: { color: 'white' } } }]] }) }))
afterEach(() => { resetHighlightWorker(); _resetClientTelemetry(); vi.unstubAllGlobals() })
it('attributes unavailable-worker fallback without sending the document or path', async () => {
  vi.stubGlobal('Worker', undefined)
  const records: TelemetryRecord[] = []
  startClientTelemetry({ runtime: 'renderer', post: async (batch) => { records.push(...batch) } })
  setTelemetryEnabled(true)
  const lines = await tokenizeDocument('/private/customer.ts', 'secret_customer_value')
  expect(lines[0][0].content).toBe('secret_customer_value')
  await flushTelemetry()
  expect(records.find((r) => r.kind === 'metric' && r.name === 'highlight.fallback')).toMatchObject({ attrs: { reason: 'unavailable' } })
  expect(records.find((r) => r.kind === 'metric' && r.name === 'highlight.main_thread')).toBeDefined()
  expect(JSON.stringify(records)).not.toContain('customer')
})
