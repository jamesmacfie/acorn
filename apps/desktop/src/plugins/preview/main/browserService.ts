// Drivable browser — the CDP service (docs/panes.md): drives the task's EXISTING preview
// WebContentsView via webContents.debugger. One driver per task; refs come from the last snapshot
// (browserAuto.ts owns the pure transforms). Commands originate from main/agent only — never from
// page script (vNext §11 posture); navigation stays http(s)-only like the preview navigation guard.
import type { WebContents } from 'electron'
import { buildAxTree, isAllowedBrowserUrl, isBenignNavError, renderAxTree, resolveRef, type AxSnapshot } from './browserAuto'

const CONSOLE_CAP = 200

// The webContents surface the driver needs (structural, so the smoke script can drive a plain
// BrowserWindow's webContents and tests can stub it).
export type DrivableContents = Pick<WebContents, 'loadURL' | 'getURL' | 'isDestroyed'> & {
  debugger: Pick<WebContents['debugger'], 'attach' | 'isAttached' | 'sendCommand' | 'on'>
}

export class BrowserDriver {
  private snapshot: AxSnapshot | null = null
  private consoleLines: string[] = []

  constructor(private contents: DrivableContents) {}

  private attach(): void {
    if (this.contents.debugger.isAttached()) return
    this.contents.debugger.attach('1.3')
    this.contents.debugger.on('message', (_e, method, params) => {
      // Buffer console output (Runtime + Log) for browser_console.
      if (method === 'Runtime.consoleAPICalled') {
        const p = params as { type: string; args: { value?: unknown; description?: string }[] }
        const line = p.args.map((a) => (a.value != null ? String(a.value) : (a.description ?? ''))).join(' ')
        this.push(`[${p.type}] ${line}`)
      } else if (method === 'Log.entryAdded') {
        const p = params as { entry: { level: string; text: string } }
        this.push(`[${p.entry.level}] ${p.entry.text}`)
      }
    })
    void this.contents.debugger.sendCommand('Runtime.enable')
    void this.contents.debugger.sendCommand('Log.enable')
  }

  private push(line: string): void {
    this.consoleLines.push(line)
    if (this.consoleLines.length > CONSOLE_CAP) this.consoleLines.splice(0, this.consoleLines.length - CONSOLE_CAP)
  }

  private send<T = unknown>(method: string, params?: unknown): Promise<T> {
    this.attach()
    return this.contents.debugger.sendCommand(method, params as never) as Promise<T>
  }

  async navigate(url: string): Promise<{ ok: boolean; reason?: string }> {
    if (!isAllowedBrowserUrl(url)) return { ok: false, reason: 'Only http(s) URLs are drivable.' }
    this.attach()
    try {
      await this.contents.loadURL(url)
    } catch (err) {
      if (!isBenignNavError(err)) return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
    return { ok: true }
  }

  async takeSnapshot(): Promise<{ url: string; text: string; tree: AxSnapshot['tree'] }> {
    await this.send('Accessibility.enable')
    const { nodes } = await this.send<{ nodes: never[] }>('Accessibility.getFullAXTree')
    this.snapshot = buildAxTree(nodes)
    return { url: this.contents.getURL(), text: renderAxTree(this.snapshot.tree), tree: this.snapshot.tree }
  }

  private async centerOf(backendNodeId: number): Promise<{ x: number; y: number }> {
    const { model } = await this.send<{ model: { content: number[] } }>('DOM.getBoxModel', { backendNodeId })
    const q = model.content // [x1,y1, x2,y2, x3,y3, x4,y4]
    return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2 }
  }

  async click(ref: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      const backendNodeId = resolveRef(this.snapshot, ref)
      await this.send('DOM.getDocument') // ensures the DOM domain knows current nodes
      const { x, y } = await this.centerOf(backendNodeId)
      const base = { x, y, button: 'left' as const, clickCount: 1 }
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  }

  async fill(ref: string, textValue: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      const backendNodeId = resolveRef(this.snapshot, ref)
      await this.send('DOM.getDocument')
      // Clear the current value via the resolved node (never page-authored script paths), then
      // focus + insertText so framework listeners see a real input.
      const { object } = await this.send<{ object: { objectId: string } }>('DOM.resolveNode', { backendNodeId })
      await this.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: 'function () { if ("value" in this) { this.value = ""; this.dispatchEvent(new Event("input", { bubbles: true })) } }',
      })
      await this.send('DOM.focus', { backendNodeId })
      await this.send('Input.insertText', { text: textValue })
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  }

  async screenshot(): Promise<{ dataUri: string }> {
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
    return { dataUri: `data:image/png;base64,${data}` }
  }

  console(): { lines: string[] } {
    this.attach() // start buffering on first interest
    return { lines: [...this.consoleLines] }
  }
}

// Per-task drivers over the preview WebContentsView (previewService.ts binds each view's webContents
// on creation — main-owned, so no renderer round-trip).
const drivers = new Map<string, BrowserDriver>()
const contentsByTask = new Map<string, DrivableContents>()

export function bindBrowserContents(taskId: string, contents: DrivableContents): void {
  contentsByTask.set(taskId, contents)
  drivers.delete(taskId) // a fresh view invalidates the old driver + refs
}

// Preview eviction owns the inverse binding. The identity guard prevents a late close from deleting
// a replacement view that has already been bound for the same task.
export function unbindBrowserContents(taskId: string, contents: DrivableContents): void {
  if (contentsByTask.get(taskId) !== contents) return
  contentsByTask.delete(taskId)
  drivers.delete(taskId)
}

export function driverFor(taskId: string): BrowserDriver | null {
  const contents = contentsByTask.get(taskId)
  if (!contents || contents.isDestroyed()) return null
  let driver = drivers.get(taskId)
  if (!driver) {
    driver = new BrowserDriver(contents)
    drivers.set(taskId, driver)
  }
  return driver
}
