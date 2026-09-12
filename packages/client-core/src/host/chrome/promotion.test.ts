import { describe, expect, it, vi } from 'vitest'
import type { PluginRailItem, Task } from '@acorn/protocol/api.ts'
import { descriptorPromotion } from './promotion'

const ITEM: PluginRailItem = {
  id: 'ENG-42',
  title: 'Ship portable promotion',
  task: {
    branch: 'eng-42',
    link: { connectionId: 'connection-1', identifier: 'ENG-42', ref: { displayId: 'ENG-42' } },
  },
}

const TASK = { id: 'task-1' } as Task
const owned = { ownsConnection: vi.fn(async () => true) }

describe('descriptor promotion', () => {
  it('derives a host-owned origin and row seed', async () => {
    const promotion = descriptorPromotion('tracker', { create: vi.fn(), link: vi.fn(), ...owned })
    expect(await Promise.resolve(promotion.prepare(ITEM, {
      projectId: 'project-1', owner: '', repo: '', branch: 'fallback',
    }))).toEqual({
      origin: 'tracker:item',
      projectId: 'project-1',
      title: 'Ship portable promotion',
      branch: 'eng-42',
    })
  })

  it('preserves an established provider origin when the row declares one', async () => {
    const promotion = descriptorPromotion('rollbar', { create: vi.fn(), link: vi.fn(), ...owned })
    expect(await promotion.prepare(
      { ...ITEM, task: { ...ITEM.task, origin: 'rollbar' } },
      { projectId: 'project-1', owner: '', repo: '' },
    )).toMatchObject({ origin: 'rollbar' })
  })

  it('replaces an origin owned by another plugin while preserving owned subtypes', async () => {
    const promotion = descriptorPromotion('rollbar', { create: vi.fn(), link: vi.fn(), ...owned })
    const context = { projectId: 'project-1', owner: '', repo: '' }

    await expect(promotion.prepare(
      { ...ITEM, task: { ...ITEM.task, origin: 'linear' } },
      context,
    )).resolves.toMatchObject({ origin: 'rollbar:item' })
    await expect(promotion.prepare(
      { ...ITEM, task: { ...ITEM.task, origin: 'rollbar:error' } },
      context,
    )).resolves.toMatchObject({ origin: 'rollbar:error' })
  })

  it('creates first and links second', async () => {
    const order: string[] = []
    const promotion = descriptorPromotion('tracker', {
      create: async () => { order.push('create'); return TASK },
      link: async () => { order.push('link') },
      ownsConnection: async () => true,
    })
    const task = await promotion.create(await promotion.prepare(ITEM, { projectId: 'project-1', owner: '', repo: '' }))
    await promotion.afterCreate?.(task, ITEM, { projectId: 'project-1', owner: '', repo: '' })
    expect(order).toEqual(['create', 'link'])
  })

  it('surfaces a failed link after the task has already been created', async () => {
    const order: string[] = []
    const promotion = descriptorPromotion('tracker', {
      create: async () => { order.push('create'); return TASK },
      link: async () => { order.push('link'); throw new Error('link failed') },
      ownsConnection: async () => true,
    })
    const task = await promotion.create(await promotion.prepare(ITEM, { projectId: 'project-1', owner: '', repo: '' }))
    await expect(promotion.afterCreate?.(task, ITEM, { projectId: 'project-1', owner: '', repo: '' }))
      .rejects.toThrow('link failed')
    expect(order).toEqual(['create', 'link'])
  })

  it('attaches the row link to an existing task without creating another one', async () => {
    const create = vi.fn()
    const link = vi.fn().mockResolvedValue(undefined)
    const promotion = descriptorPromotion('tracker', { create, link, ownsConnection: async () => true })

    await promotion.attachToCurrentTask?.('task-existing', ITEM)

    expect(create).not.toHaveBeenCalled()
    expect(link).toHaveBeenCalledWith('task-existing', ITEM.task?.link)
  })

  it('refuses to attach a connection owned by another provider', async () => {
    const link = vi.fn()
    const promotion = descriptorPromotion('tracker', {
      create: vi.fn(),
      link,
      ownsConnection: async () => false,
    })

    await expect(promotion.attachToCurrentTask?.('task-existing', ITEM)).rejects.toThrow(/does not own/)
    expect(link).not.toHaveBeenCalled()
  })
})
