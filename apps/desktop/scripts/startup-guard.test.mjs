import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

const guard = readFileSync(new URL('../public/startup-guard.js', import.meta.url), 'utf8')
const RETRY_KEY = 'acorn:renderer-startup-retries'

function loadGuard(status, saved) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://acorn.test/' })
  const values = new Map()
  if (saved) values.set(RETRY_KEY, saved)
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
  const reload = vi.fn()
  const timers = []
  const fetch = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => status === 200 ? 'text/javascript; charset=utf-8' : 'text/plain' },
  })
  runInNewContext(guard, {
    window: dom.window,
    document: dom.window.document,
    HTMLScriptElement: dom.window.HTMLScriptElement,
    MutationObserver: dom.window.MutationObserver,
    sessionStorage: storage,
    location: { reload },
    fetch,
    setTimeout: (callback, delay) => { timers.push({ callback, delay }) },
    URL,
    Date,
    Error,
  })
  const script = dom.window.document.createElement('script')
  script.src = 'app://acorn/src/client/index.tsx'
  dom.window.document.body.append(script)
  script.dispatchEvent(new dom.window.Event('error'))
  return { dom, fetch, reload, timers, values }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('renderer startup guard', () => {
  it('shows progress and reloads after a transient Vite response', async () => {
    const { dom, fetch, reload, timers, values } = loadGuard(504)
    await settle()

    expect(fetch).toHaveBeenCalledWith('app://acorn/src/client/index.tsx', { cache: 'no-store' })
    expect(dom.window.document.querySelector('[role="status"]')?.textContent).toContain('Retrying (1/4)')
    expect(timers).toHaveLength(1)
    expect(timers[0]?.delay).toBe(250)
    expect(JSON.parse(values.get(RETRY_KEY) ?? 'null').count).toBe(1)
    timers[0]?.callback()
    expect(reload).toHaveBeenCalledOnce()
    dom.window.close()
  })

  it('also reloads when the entry has recovered by the time it is probed', async () => {
    const { dom, timers, values } = loadGuard(200)
    await settle()
    expect(timers).toHaveLength(1)

    dom.window.document.getElementById('root')?.replaceChildren(dom.window.document.createElement('div'))
    await settle()
    expect(values.has(RETRY_KEY)).toBe(false)
    dom.window.close()
  })

  it('shows the failure for a real transform error', async () => {
    const { dom, timers } = loadGuard(500)
    await settle()
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain('Could not load app://acorn/src/client/index.tsx')
    expect(timers).toHaveLength(0)
    dom.window.close()
  })

  it('stops automatically reloading after the retry budget', async () => {
    const saved = JSON.stringify({ count: 4, at: Date.now() })
    const { dom, fetch, timers } = loadGuard(504, saved)
    await settle()
    expect(fetch).not.toHaveBeenCalled()
    expect(timers).toHaveLength(0)
    expect(dom.window.document.querySelector('[role="alert"] button')?.textContent).toBe('Reload')
    dom.window.close()
  })
})
