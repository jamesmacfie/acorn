import { describe, expect, it, vi } from 'vitest'
import { invokeLayoutRecipe, recipeToLayout, type RecipeServices } from './recipes'

const stubSvc = (overrides: Partial<RecipeServices> = {}): RecipeServices => ({
  setLayout: vi.fn(),
  startTarget: vi.fn(async () => ({ ok: true })),
  targetUrl: vi.fn(async () => 'http://localhost:8080'),
  setBrowserUrl: vi.fn(),
  openTerminal: vi.fn(),
  ...overrides,
})

describe('recipeToLayout', () => {
  it('maps panes + clamped ratio; drops unknown panes; null when none valid', () => {
    expect(recipeToLayout({ id: 'review', panes: ['pr', 'changes'], ratio: 0.5 })).toEqual({
      panes: ['pr', 'changes'],
      ratio: 0.5,
      pinned: null,
      maximised: null,
    })
    expect(recipeToLayout({ id: 'x', panes: ['pr', 'bogus'] })).toEqual({ panes: ['pr'], ratio: undefined, pinned: null, maximised: null })
    expect(recipeToLayout({ id: 'x', panes: ['pr', 'editor'], ratio: 5 })?.ratio).toBe(0.8)
    expect(recipeToLayout({ id: 'x', panes: ['nope'] })).toBeNull()
  })
})

describe('invokeLayoutRecipe (13 §C example)', () => {
  it('seeds the layout, starts the terminal target, resolves the browser URL', async () => {
    const svc = stubSvc()
    const res = await invokeLayoutRecipe('t1', { id: 'review', panes: ['pr', 'changes'], ratio: 0.5, terminal: 'dev', browser: 'run:dev' }, svc)
    expect(res).toEqual({ ok: true })
    expect(svc.setLayout).toHaveBeenCalledWith('t1', { panes: ['pr', 'changes'], ratio: 0.5, pinned: null, maximised: null })
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
