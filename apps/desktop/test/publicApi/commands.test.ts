import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHarness, type Harness } from './harness'

describe('core command discovery + invocation', () => {
  let h: Harness
  beforeEach(async () => {
    h = await makeHarness()
  })
  afterEach(() => h.cleanup())

  it('lists command descriptors with generated input JSON Schema', async () => {
    const res = await h.request('/api/v1/commands', {}, h.readToken)
    expect(res.status).toBe(200)
    const items = (await res.json()).data.items as { id: string; requiredScope: string; inputSchema: unknown; target: string }[]
    const paneShow = items.find((c) => c.id === 'core.pane.show')
    expect(paneShow).toBeDefined()
    expect(paneShow?.requiredScope).toBe('write')
    expect(paneShow?.target).toBe('renderer')
    expect(paneShow?.inputSchema).toBeTruthy()
  })

  it('filters by category and gets one descriptor', async () => {
    const paneOnly = (await (await h.request('/api/v1/commands?category=pane', {}, h.readToken)).json()).data.items as { id: string }[]
    expect(paneOnly.every((c) => c.id.includes('pane') || c.id.includes('surface'))).toBe(true)

    const one = await h.request('/api/v1/commands/core.task.activate', {}, h.readToken)
    expect(one.status).toBe(200)
    expect((await one.json()).data.id).toBe('core.task.activate')

    const missing = await h.request('/api/v1/commands/core.nope', {}, h.readToken)
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.code).toBe('command_not_found')
  })

  const invoke = (id: string, input: unknown, token: string) =>
    h.request(`/api/v1/commands/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input }) }, token)

  it('requires write scope, validates input, and 409s a presentation command with no renderer', async () => {
    // read token → 403
    expect((await invoke('core.pane.show', { taskId: '11111111-1111-4111-8111-111111111111', paneId: 'pr' }, h.readToken)).status).toBe(403)

    // invalid input → 422
    const bad = await invoke('core.pane.show', { taskId: 'not-a-uuid' }, h.writeToken)
    expect(bad.status).toBe(422)

    // valid input, but no broker/renderer → 409 ui_unavailable
    const ok = await invoke('core.pane.show', { taskId: '11111111-1111-4111-8111-111111111111', paneId: 'pr' }, h.writeToken)
    expect(ok.status).toBe(409)
    expect((await ok.json()).error.code).toBe('ui_unavailable')

    // unknown command → 404
    expect((await invoke('core.ghost', {}, h.writeToken)).status).toBe(404)
  })
})
