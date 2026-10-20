import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelPlan, SuppliedRows } from '@acorn/protocol/dashboards.ts'

const writeJson = vi.fn()
vi.mock('../../infra/node/apiClient', () => ({ writeJson: (...args: unknown[]) => writeJson(...args) }))

const { default: KeepUpdatedSheet } = await import('./KeepUpdatedSheet')

const rows: SuppliedRows = {
  kind: 'supplied',
  origin: { says: 'Open-Meteo forecast', readAt: Date.parse('2026-10-20T05:31:00Z') },
  schema: { type: 'object', properties: { day: { type: 'string' }, high: { type: 'number' } } },
  fields: [
    { pointer: '/day', label: 'Day', origin: 'declared' },
    { pointer: '/high', label: 'High', origin: 'declared' },
  ],
  rows: [
    { day: '2026-10-20', high: 17 },
    { day: '2026-10-21', high: 15 },
  ],
}
const plan: PanelPlan = {
  version: 2,
  title: 'Forecast',
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [{ id: 'forecast', label: 'Forecast', role: 'primary', reference: rows }],
  columns: [{ id: 'day', label: 'Day', type: 'text', bind: { forecast: { field: '/day' } } }],
  stages: [],
  view: { kind: 'table' },
}

let dispose: (() => void) | undefined
beforeEach(() => writeJson.mockReset())
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
})
const show = (onKeep: (plan: PanelPlan) => Promise<void>, onClose = vi.fn()) => {
  dispose = render(
    () => (
      <KeepUpdatedSheet
        nodeId="node"
        workspaceId="ws"
        projectId="project"
        taskId="task"
        plan={plan}
        rows={rows}
        destination="Home"
        onKeep={onKeep}
        onClose={onClose}
      />
    ),
    document.body.appendChild(document.createElement('div')),
  )
  return onClose
}
const create = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((entry) => entry.textContent === 'Create')!

describe('KeepUpdatedSheet', () => {
  it('suggests the latest state keyed by day, and places a plan reading the new dataset', async () => {
    writeJson.mockResolvedValue({ dataset: { id: 'd1' } })
    const onKeep = vi.fn(async () => {})
    const onClose = show(onKeep)
    expect(document.body.textContent).toContain('Latest state')
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true)
    create().click()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    const [url, init] = writeJson.mock.calls[0]!
    expect(url).toBe('/v1/core/datasets')
    expect(JSON.parse(init.body)).toMatchObject({
      workspaceId: 'ws',
      mode: 'current-mirror',
      identityFields: ['/day'],
      refresh: { projectId: 'project', taskId: 'task', origin: { says: 'Open-Meteo forecast' } },
    })
    expect(onKeep).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [
          expect.objectContaining({
            reference: expect.objectContaining({
              content: expect.objectContaining({
                query: expect.objectContaining({ source: { pluginId: 'core', sourceId: 'dataset:d1' } }),
              }),
            }),
          }),
        ],
      }),
    )
  })

  it('deletes the dataset it made when placing the panel fails', async () => {
    writeJson.mockResolvedValueOnce({ dataset: { id: 'd1' } }).mockResolvedValueOnce({ ok: true })
    const onClose = show(async () => Promise.reject(new Error('The region is full.')))
    create().click()
    await vi.waitFor(() => expect(document.body.textContent).toContain('The region is full.'))
    expect(writeJson.mock.calls[1]).toEqual([
      '/v1/core/datasets/d1?workspaceId=ws',
      { method: 'DELETE', nodeId: 'node' },
    ])
    expect(onClose).not.toHaveBeenCalled()
  })
})
