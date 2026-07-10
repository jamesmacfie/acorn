import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { invokeLayoutRecipe, recipeToLayout, type RecipeServices } from './recipes'
import { paneRegistry } from '../../../core/client/registries/panes'

const paneRegistrations: { dispose(): void }[] = []
beforeAll(() => {
  for (const [id, order] of [['pr', 1], ['changes', 2]] as const) {
    paneRegistrations.push(paneRegistry.register({
      id, order, label: id, glyph: id, component: () => null,
    }))
  }
})
afterAll(() => paneRegistrations.splice(0).forEach((registration) => registration.dispose()))

const stubSvc = (overrides: Partial<RecipeServices> = {}): RecipeServices => ({
  setLayout: vi.fn(),
  startTarget: vi.fn(async () => ({ ok: true })),
  targetUrl: vi.fn(async () => 'http://localhost:8080'),
  setBrowserUrl: vi.fn(),
  openTerminal: vi.fn(),
  ...overrides,
})

describe('recipeToLayout', () => {
  it('opens the known panes left→right; drops unknown/duplicate panes; null when none valid', () => {
    expect(recipeToLayout({ id: 'review', panes: ['pr', 'changes'] })).toEqual({ panes: ['pr', 'changes'] })
    expect(recipeToLayout({ id: 'x', panes: ['pr', 'pr', 'bogus'] })).toEqual({ panes: ['pr'] })
    expect(recipeToLayout({ id: 'x', panes: ['nope'] })).toBeNull()
  })
})

describe('invokeLayoutRecipe (13 §C example)', () => {
  it('seeds the layout, starts the terminal target, resolves the browser URL', async () => {
    const svc = stubSvc()
    const res = await invokeLayoutRecipe('t1', { id: 'review', panes: ['pr', 'changes'], terminal: 'dev', browser: 'run:dev' }, svc)
    expect(res).toEqual({ ok: true })
    expect(svc.setLayout).toHaveBeenCalledWith('t1', { panes: ['pr', 'changes'] })
    expect(svc.startTarget).toHaveBeenCalledTimes(1) // browser target === terminal target → one start
    expect(svc.startTarget).toHaveBeenCalledWith('t1', 'dev')
    expect(svc.openTerminal).toHaveBeenCalledWith('t1')
    expect(svc.targetUrl).toHaveBeenCalledWith('t1', 'dev')
    expect(svc.setBrowserUrl).toHaveBeenCalledWith('t1', 'http://localhost:8080')
  })

  it('starts a distinct browser target and skips the URL when unresolvable', async () => {
    const svc = stubSvc({ targetUrl: vi.fn(async () => undefined) })
    const res = await invokeLayoutRecipe('t1', { id: 'x', panes: ['pr'], browser: 'run:stack' }, svc)
    expect(res.ok).toBe(true)
    expect(svc.startTarget).toHaveBeenCalledWith('t1', 'stack')
    expect(svc.setBrowserUrl).not.toHaveBeenCalled()
  })

  it('fails cleanly on invalid panes or a failed target start', async () => {
    const svc = stubSvc()
    expect((await invokeLayoutRecipe('t1', { id: 'bad', panes: [] }, svc)).ok).toBe(false)
    const failing = stubSvc({ startTarget: vi.fn(async () => ({ ok: false, reason: 'nope' })) })
    const res = await invokeLayoutRecipe('t1', { id: 'x', panes: ['pr'], terminal: 'dev' }, failing)
    expect(res).toEqual({ ok: false, reason: 'nope' })
    expect(failing.openTerminal).not.toHaveBeenCalled()
  })
})
