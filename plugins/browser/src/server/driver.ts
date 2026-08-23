import type { Browser, BrowserContext, CDPSession, Page } from 'playwright-core'
import { buildAxTree, isAllowedBrowserUrl, renderAxTree, resolveRef, type AxSnapshot } from './axTree'

// One Playwright browser for the node, one incognito context and page per task, and a CDP session on
// each page for the accessibility tree. See docs/agent-tools.md § Browser tools.
//
// CDP rather than Playwright locators, because an agent needs stable per-snapshot refs it can name back
// to us, and `Accessibility.getFullAXTree` plus ./axTree.ts produce those. Playwright covers launching,
// waiting, screenshots, and console capture.
//
// The bundle ships no browser: bundles are hash-addressed and a Chromium is 150 MB per platform. This
// drives an installed Chrome, and says so when there is not one.

const CONSOLE_CAP = 200

// How many task browsing contexts stay alive. Each carries its own cookies and storage, and a
// long-running node works through a lot of tasks.
//
// ponytail: the oldest closes when a new one is needed, because nothing tells this plugin a task was
// archived. If a task-lifecycle signal ever reaches a plugin, close on that and delete the cap.
const MAX_SESSIONS = 8

// Tried in order of what a developer machine most likely already has. The bare `launch()` fallback
// picks up PLAYWRIGHT_BROWSERS_PATH.
const CHANNELS = ['chrome', 'chromium'] as const

export const NO_BROWSER =
  'No Chrome or Chromium on this machine. Install Google Chrome, or point PLAYWRIGHT_BROWSERS_PATH at a Playwright browser directory, and try again.'

/// `ok: false` is an answer, not a crash. An agent that asked for something impossible gets told what
/// happened and can try something else.
export type Outcome = { ok: true } | { ok: false; reason: string }

export type Capture = { id: string; mime: string; bytes: Buffer; taskId: string }

/// Where a screenshot goes. The plugin's own table implements it, a test passes something simpler, and
/// this file never learns what a database is. See docs/agent-tools.md § Browser tools.
export type CaptureStore = { put(capture: Omit<Capture, 'id'>): Promise<{ id: string }> }

type Session = { context: BrowserContext; page: Page; cdp: CDPSession; console: string[]; snapshot: AxSnapshot | null }

export class BrowserPool {
  #browser: Browser | null = null
  #sessions = new Map<string, Session>()
  #launching: Promise<Browser> | null = null

  constructor(private readonly captures: CaptureStore) {}

  /// Launch once, lazily, and share. Nothing happens at plugin init, because an idle node should not
  /// pay for a browser process.
  async #launch(): Promise<Browser> {
    if (this.#browser?.isConnected()) return this.#browser
    this.#launching ??= (async () => {
      const { chromium } = await import('playwright-core')
      let last: unknown
      for (const channel of CHANNELS) {
        try {
          return await chromium.launch({ channel })
        } catch (error) {
          last = error
        }
      }
      try {
        return await chromium.launch()
      } catch {
        throw new Error(`${NO_BROWSER} (${last instanceof Error ? last.message : String(last)})`)
      }
    })()
      .then((browser) => {
        this.#browser = browser
        // The owner closed it by hand, or it crashed. The next call launches a new one rather than
        // handing back a dead handle.
        browser.once('disconnected', () => {
          this.#browser = null
          this.#sessions.clear()
        })
        return browser
      })
      .finally(() => {
        this.#launching = null
      })
    return this.#launching
  }

  /// One context per task, so one task's cookies, storage, and logins never reach another's.
  async #session(taskId: string): Promise<Session> {
    const existing = this.#sessions.get(taskId)
    if (existing && !existing.page.isClosed()) return existing
    const browser = await this.#launch()
    // Insertion order is the eviction order, which a Map already gives.
    for (const oldest of [...this.#sessions.keys()].slice(0, Math.max(0, this.#sessions.size - MAX_SESSIONS + 1))) {
      await this.release(oldest)
    }
    const context = await browser.newContext()
    const page = await context.newPage()
    const session: Session = { context, page, cdp: await context.newCDPSession(page), console: [], snapshot: null }
    page.on('console', (message) => {
      session.console.push(`[${message.type()}] ${message.text()}`)
      if (session.console.length > CONSOLE_CAP) session.console.splice(0, session.console.length - CONSOLE_CAP)
    })
    page.on('pageerror', (error) => session.console.push(`[error] ${error.message}`))
    this.#sessions.set(taskId, session)
    return session
  }

  async navigate(taskId: string, url: string): Promise<Outcome> {
    if (!isAllowedBrowserUrl(url)) return { ok: false, reason: 'Only http(s) URLs are drivable.' }
    return this.#attempt(taskId, async (session) => {
      await session.page.goto(url, { waitUntil: 'domcontentloaded' })
      // Refs are per snapshot and the page underneath them just changed.
      session.snapshot = null
    })
  }

  async snapshot(taskId: string): Promise<{ url: string; text: string } | { error: string }> {
    try {
      const session = await this.#session(taskId)
      await session.cdp.send('Accessibility.enable')
      const { nodes } = (await session.cdp.send('Accessibility.getFullAXTree')) as { nodes: never[] }
      session.snapshot = buildAxTree(nodes)
      return { url: session.page.url(), text: renderAxTree(session.snapshot.tree) }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  async click(taskId: string, ref: string): Promise<Outcome> {
    return this.#attempt(taskId, async (session) => {
      const backendNodeId = resolveRef(session.snapshot, ref)
      await session.cdp.send('DOM.getDocument')
      const { model } = (await session.cdp.send('DOM.getBoxModel', { backendNodeId })) as { model: { content: number[] } }
      // content is [x1,y1, x2,y2, x3,y3, x4,y4]; the centre is the midpoint of the diagonal.
      const [x1, y1, , , x3, y3] = model.content
      await session.page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2)
    })
  }

  async fill(taskId: string, ref: string, text: string): Promise<Outcome> {
    return this.#attempt(taskId, async (session) => {
      const backendNodeId = resolveRef(session.snapshot, ref)
      await session.cdp.send('DOM.getDocument')
      // Clear through the resolved node, not a selector, so the page cannot substitute a different
      // element between the snapshot and the write. Focus and type so frameworks see real input events.
      const { object } = (await session.cdp.send('DOM.resolveNode', { backendNodeId })) as { object: { objectId: string } }
      await session.cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: 'function () { if ("value" in this) { this.value = ""; this.dispatchEvent(new Event("input", { bubbles: true })) } }',
      })
      await session.cdp.send('DOM.focus', { backendNodeId })
      await session.page.keyboard.insertText(text)
    })
  }

  /// Persisted, not inlined, so the handle still resolves after the transcript is gone.
  async screenshot(taskId: string): Promise<{ captureId: string; url: string; bytes: number } | { error: string }> {
    try {
      const session = await this.#session(taskId)
      const bytes = await session.page.screenshot({ type: 'png' })
      const { id } = await this.captures.put({ taskId, mime: 'image/png', bytes })
      return { captureId: id, url: `/v2/p/browser/captures/${id}`, bytes: bytes.byteLength }
    } catch (error) {
      return { error: reason(error) }
    }
  }

  async console(taskId: string): Promise<{ lines: string[] }> {
    const session = this.#sessions.get(taskId)
    return { lines: session ? [...session.console] : [] }
  }

  /// Drop one task's browsing. The context takes its cookies and storage with it.
  async release(taskId: string): Promise<void> {
    const session = this.#sessions.get(taskId)
    if (!session) return
    this.#sessions.delete(taskId)
    await session.context.close().catch(() => {})
  }

  async dispose(): Promise<void> {
    this.#sessions.clear()
    const browser = this.#browser
    this.#browser = null
    await browser?.close().catch(() => {})
  }

  async #attempt(taskId: string, action: (session: Session) => Promise<void>): Promise<Outcome> {
    try {
      await action(await this.#session(taskId))
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: reason(error) }
    }
  }
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))
