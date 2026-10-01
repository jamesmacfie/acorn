import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { BrowserPool } from './driver'

const launcher = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('playwright-core', () => ({ chromium: launcher }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

class FakePage extends EventEmitter {
  closed = false
  goto = vi.fn(async () => {})
  isClosed() { return this.closed }
}

class FakeContext {
  page = new FakePage()
  closed = false
  newPage = vi.fn(async () => this.page)
  newCDPSession = vi.fn(async () => ({ send: vi.fn() }))
  close = vi.fn(async () => { this.closed = true; this.page.closed = true })
}

class FakeBrowser extends EventEmitter {
  connected = true
  contexts: FakeContext[] = []
  maxAlive = 0
  newContext = vi.fn(async () => {
    const context = new FakeContext()
    this.contexts.push(context)
    this.maxAlive = Math.max(this.maxAlive, this.contexts.filter((item) => !item.closed).length)
    return context
  })
  isConnected() { return this.connected }
  close = vi.fn(async () => {
    this.connected = false
    await Promise.all(this.contexts.map((context) => context.close()))
    this.emit('disconnected')
  })
}

let browser: FakeBrowser
let pool: BrowserPool
beforeEach(() => {
  browser = new FakeBrowser()
  launcher.launch.mockReset().mockResolvedValue(browser)
  pool = new BrowserPool({ put: async () => ({ id: 'synthetic-capture' }) })
})
afterEach(async () => { await pool.dispose() })

describe('browser session accounting', () => {
  it('deduplicates simultaneous same-task allocations', async () => {
    expect(await Promise.all([pool.navigate('a', 'http://fixture.test'), pool.navigate('a', 'http://fixture.test')]))
      .toEqual([{ ok: true }, { ok: true }])
    expect(launcher.launch).toHaveBeenCalledTimes(1)
    expect(browser.newContext).toHaveBeenCalledTimes(1)
    expect(browser.contexts[0].page.goto).toHaveBeenCalledTimes(2)
  })

  it('keeps distinct contexts and evicts before exceeding eight live contexts', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, task) => pool.navigate(String(task), 'http://fixture.test')))
    expect(new Set(browser.contexts).size).toBe(12)
    expect(browser.maxAlive).toBe(8)
    expect(browser.contexts.filter((context) => !context.closed)).toHaveLength(8)
    expect(browser.contexts.slice(0, 4).every((context) => context.closed)).toBe(true)
  })

  it.each(['new-task', '0'])('waits for a released context to close before allocating %s', async (taskId) => {
    await Promise.all(Array.from({ length: 8 }, (_, task) => pool.navigate(String(task), 'http://fixture.test')))
    const pending = deferred<void>()
    const started = deferred<void>()
    const context = browser.contexts[0]
    context.close.mockImplementationOnce(async () => {
      started.resolve()
      await pending.promise
      context.closed = true
      context.page.closed = true
    })
    const released = pool.release('0')
    await started.promise
    const opening = pool.navigate(taskId, 'http://fixture.test')
    await Promise.resolve()
    expect(browser.newContext).toHaveBeenCalledTimes(8)
    pending.resolve()
    await released
    expect(await opening).toEqual({ ok: true })
    expect(browser.maxAlive).toBe(8)
    expect(browser.contexts.filter((item) => !item.closed)).toHaveLength(8)
  })

  it('does not free capacity when closing an otherwise live context fails', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, task) => pool.navigate(String(task), 'http://fixture.test')))
    browser.contexts[0].close.mockRejectedValue(new Error('context close failed'))
    await expect(pool.release('0')).rejects.toThrow('context close failed')
    // Another context may be evicted instead, but the failed one remains accounted for and cannot
    // be returned to a caller after release.
    expect(await pool.navigate('new-task', 'http://fixture.test')).toEqual({ ok: true })
    expect(await pool.navigate('0', 'http://fixture.test')).toEqual({ ok: false, reason: 'context close failed' })
    expect(browser.newContext).toHaveBeenCalledTimes(9)
    expect(browser.maxAlive).toBe(8)
  })

  it.each(['page', 'cdp'])('closes a partially allocated context on %s failure and allows retry', async (failure) => {
    const context = new FakeContext()
    if (failure === 'page') context.newPage.mockRejectedValueOnce(new Error('page failed'))
    else context.newCDPSession.mockRejectedValueOnce(new Error('cdp failed'))
    browser.newContext.mockResolvedValueOnce(context)
    expect(await pool.navigate('a', 'http://fixture.test')).toEqual({ ok: false, reason: `${failure} failed` })
    expect(context.closed).toBe(true)
    expect(await pool.navigate('a', 'http://fixture.test')).toEqual({ ok: true })
    expect(browser.newContext).toHaveBeenCalledTimes(2)
  })

  it('retries failed partial cleanup before creating another context', async () => {
    const context = new FakeContext()
    context.newPage.mockRejectedValueOnce(new Error('page failed'))
    context.close.mockRejectedValueOnce(new Error('close failed')).mockRejectedValueOnce(new Error('close still failed'))
    browser.newContext.mockResolvedValueOnce(context)
    expect(await pool.navigate('a', 'http://fixture.test')).toEqual({ ok: false, reason: 'page failed' })
    expect(await pool.navigate('b', 'http://fixture.test')).toEqual({ ok: false, reason: 'close still failed' })
    expect(browser.newContext).toHaveBeenCalledTimes(1)
    expect(await pool.navigate('b', 'http://fixture.test')).toEqual({ ok: true })
    expect(context.closed).toBe(true)
    expect(browser.newContext).toHaveBeenCalledTimes(2)
  })

  it('closes the old context when its page has closed', async () => {
    await pool.navigate('a', 'http://fixture.test')
    browser.contexts[0].page.closed = true
    await pool.navigate('a', 'http://fixture.test')
    expect(browser.contexts[0].closed).toBe(true)
    expect(browser.contexts.filter((context) => !context.closed)).toHaveLength(1)
  })

  it('cancels release during allocation and permits a fresh request afterward', async () => {
    const pending = deferred<FakeContext>()
    const started = deferred<void>()
    browser.newContext.mockImplementationOnce(() => { started.resolve(); return pending.promise })
    const opening = pool.navigate('a', 'http://fixture.test')
    await started.promise
    const released = pool.release('a')
    const fresh = pool.navigate('a', 'http://fixture.test')
    const late = new FakeContext()
    pending.resolve(late)
    expect(await opening).toMatchObject({ ok: false, reason: expect.stringContaining('cancelled') })
    await released
    expect(late.closed).toBe(true)
    expect(late.newPage).not.toHaveBeenCalled()
    expect(await fresh).toEqual({ ok: true })
    expect(browser.newContext).toHaveBeenCalledTimes(2)
  })

  it('cancels queued requests before allocating their contexts', async () => {
    const pending = deferred<FakeContext>()
    const started = deferred<void>()
    browser.newContext.mockImplementationOnce(() => { started.resolve(); return pending.promise })
    const opening = pool.navigate('a', 'http://fixture.test')
    await started.promise
    const queued = pool.navigate('b', 'http://fixture.test')
    const released = pool.release('b')
    pending.resolve(new FakeContext())
    expect(await opening).toEqual({ ok: true })
    expect(await queued).toMatchObject({ ok: false })
    await released
    expect(browser.newContext).toHaveBeenCalledTimes(1)
  })

  it('closes a browser that launches after disposal and never publishes a context', async () => {
    const pending = deferred<FakeBrowser>()
    const started = deferred<void>()
    launcher.launch.mockImplementationOnce(() => { started.resolve(); return pending.promise })
    const opening = pool.navigate('a', 'http://fixture.test')
    await started.promise
    const disposed = pool.dispose()
    pending.resolve(browser)
    expect(await opening).toMatchObject({ ok: false })
    await disposed
    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(browser.newContext).not.toHaveBeenCalled()
    expect(await pool.navigate('a', 'http://fixture.test')).toMatchObject({ ok: false, reason: expect.stringContaining('disposed') })
  })

  it('closes a context whose page finishes allocating after disposal', async () => {
    const pending = deferred<FakePage>()
    const started = deferred<void>()
    const context = new FakeContext()
    context.newPage.mockImplementationOnce(() => { started.resolve(); return pending.promise })
    browser.newContext.mockResolvedValueOnce(context)
    const opening = pool.navigate('a', 'http://fixture.test')
    await started.promise
    const disposed = pool.dispose()
    pending.resolve(context.page)
    expect(await opening).toMatchObject({ ok: false })
    await disposed
    expect(context.closed).toBe(true)
    expect(context.newCDPSession).not.toHaveBeenCalled()
    expect((await pool.console('a')).lines).toEqual([])
  })

  it('ignores a stale browser disconnected callback after reconnecting', async () => {
    await pool.navigate('a', 'http://fixture.test')
    const old = browser
    old.connected = false
    browser = new FakeBrowser()
    launcher.launch.mockResolvedValueOnce(browser)
    expect(await pool.navigate('b', 'http://fixture.test')).toEqual({ ok: true })
    old.emit('disconnected')
    expect(await pool.navigate('b', 'http://fixture.test')).toEqual({ ok: true })
    expect(launcher.launch).toHaveBeenCalledTimes(2)
    expect(browser.newContext).toHaveBeenCalledTimes(1)
  })

  it('routes console and page errors through shared bounded diagnostics', async () => {
    await pool.navigate('a', 'http://fixture.test')
    const page = browser.contexts[0].page
    for (let index = 0; index < 210; index++) {
      page.emit(index % 2 ? 'pageerror' : 'console', index % 2 ? new Error('🙂'.repeat(2200)) :
        { type: () => 'log', text: () => '🙂'.repeat(2200) })
    }
    const { lines } = await pool.console('a')
    expect(lines.length).toBeLessThanOrEqual(200)
    expect(lines.some((line) => line.startsWith('[error]'))).toBe(true)
    expect(lines.some((line) => line.startsWith('[log]'))).toBe(true)
    expect(lines.every((line) => Buffer.byteLength(line) <= 8192 && line.includes('[truncated]'))).toBe(true)
    expect(lines.reduce((bytes, line) => bytes + Buffer.byteLength(line), 0)).toBeLessThanOrEqual(256 * 1024)
    lines.length = 0
    expect((await pool.console('a')).lines.length).toBeGreaterThan(0)
  })
})
