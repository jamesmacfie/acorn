/** @jsxImportSource @acorn/tui/jsx */
import { describe, expect, it, vi } from 'vitest'
import type { PluginRailItem, Task } from '@acorn/protocol/api.ts'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { renderFixture } from '../harness'
import { TASK } from '../fixture'
import { openPromotion } from './promotionStore'

describe('terminal source promotion', () => {
  it('does not create a second task when Enter is pressed twice during a pending create', async () => {
    const created: Task = { ...TASK, id: 'promoted-once', title: 'One linked incident' }
    let resolveCreate!: (task: Task) => void
    const create = vi.fn(() => new Promise<Task>((resolve) => { resolveCreate = resolve }))
    const registration = sourceRegistry.register({
      id: 'probe-once', order: 9999, glyph: 'x', label: 'Probe',
      promotion: {
        canPromote: () => true,
        prepare: (_item, context) => ({ origin: 'probe:item', projectId: context.projectId, title: 'One linked incident' }),
        create,
      },
    })
    const screen = await renderFixture({ width: 80, height: 24 })
    try {
      openPromotion({ pluginId: 'probe-once', projectId: 'project-1',
        item: { id: 'incident-once', title: 'One linked incident', task: { title: 'One linked incident' } } as PluginRailItem })
      await screen.until('Project: acorn')
      for (let step = 0; step < 10 && !(await screen.caret()).text.includes('One linked incident'); step++) {
        await screen.press('TAB')
      }
      expect((await screen.caret()).text).toContain('One linked incident')
      await screen.press('RETURN')
      await screen.press('RETURN')
      expect(create).toHaveBeenCalledOnce()
      resolveCreate(created)
      await vi.waitFor(async () => expect(await screen.frame()).not.toContain('Create or link task'))
    } finally {
      screen.done()
      registration.dispose()
    }
  }, 30_000)

  it('refuses creation when the source says the item is ineligible', async () => {
    const create = vi.fn(async () => TASK)
    const registration = sourceRegistry.register({
      id: 'probe-ineligible', order: 9999, glyph: 'x', label: 'Probe',
      promotion: {
        canPromote: () => false,
        prepare: (_item, context) => ({ origin: 'probe:item', projectId: context.projectId, title: 'Unavailable incident' }),
        create,
      },
    })
    const screen = await renderFixture({ width: 80, height: 24 })
    try {
      openPromotion({ pluginId: 'probe-ineligible', projectId: 'project-1',
        item: { id: 'incident-unavailable', title: 'Unavailable incident', task: { title: 'Unavailable incident' } } as PluginRailItem })
      const frame = await screen.until('cannot create a task')
      expect(frame).toContain('Create task')
      expect(await screen.reach('Create task')).toBe(false)
      expect(create).not.toHaveBeenCalled()
    } finally {
      screen.done()
      registration.dispose()
    }
  }, 30_000)

  it('creates through the source contract and links before opening the task', async () => {
    const created: Task = { ...TASK, id: 'promoted-task', title: 'Fix linked incident' }
    const create = vi.fn(async () => created)
    const afterCreate = vi.fn(async () => {})
    const registration = sourceRegistry.register({
      id: 'probe', order: 9999, glyph: 'x', label: 'Probe',
      promotion: {
        canPromote: () => true,
        prepare: (_item, context) => ({ origin: 'probe:item', projectId: context.projectId, title: 'Fix linked incident' }),
        create,
        afterCreate,
      },
    })
    const screen = await renderFixture({ width: 120, height: 40 })
    try {
      openPromotion({
        pluginId: 'probe', projectId: 'project-1',
        item: { id: 'incident-1', title: 'Fix linked incident', task: { title: 'Fix linked incident' } } as PluginRailItem,
      })
      expect(await screen.until('Fix linked incident')).toContain('Create or link task')
      await screen.until('Project: acorn')
      await screen.press('TAB')
      await screen.press('TAB')
      expect((await screen.caret()).text).toContain('Create task')
      await screen.press('RETURN')
      await vi.waitFor(() => expect(afterCreate).toHaveBeenCalledWith(created, expect.objectContaining({ id: 'incident-1' }), expect.objectContaining({ projectId: 'project-1' })))
      expect(create).toHaveBeenCalledOnce()
      expect(await screen.frame()).not.toContain('Create or link task')
    } finally {
      screen.done()
      registration.dispose()
    }
  }, 30_000)
})
