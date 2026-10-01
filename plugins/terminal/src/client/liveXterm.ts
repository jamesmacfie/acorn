import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { isAppDark, telemetryFor, watchAppearance } from '@acorn/plugin-api/client'
import { holdTerminal, type HeldTerminal } from './heldTerminals'
import { terminalApi } from './terminalClient'
import { baseTheme, monoFont, xtermTheme } from './theme'
import { TERMINAL_LINE_HEIGHT } from './preferences'

const telemetry = telemetryFor('terminal')

// xterm 5.5.0 bug: disposing a terminal (workspace/tab switch, or a task finishing in another
// workspace and stealing focus) can leave a Viewport.syncScrollArea queued for the next frame. By
// the time it fires the render service's renderer is gone, so its `dimensions` getter reads
// `_renderer.value.dimensions` on undefined and throws. The terminal is dead and the scroll sync is
// a no-op, so swallow exactly that stack (method names survive minification) and nothing else.
let scrollGuardInstalled = false
function installScrollAreaGuard() {
  if (scrollGuardInstalled || typeof window === 'undefined') return
  scrollGuardInstalled = true
  window.addEventListener('error', (e) => {
    if (e.error?.stack?.includes('syncScrollArea')) { e.preventDefault(); e.stopImmediatePropagation() }
  }, true)
}

/**
 * One session's xterm and its attachment, which outlive every surface that draws them (./heldTerminals.ts).
 * A surface lends it an element with `mount`, shows and hides it, and gives the element back with
 * `unmount`; the xterm keeps parsing its session's output throughout, so it is current whenever it
 * comes back.
 */
export type LiveXterm = HeldTerminal & {
  mount(host: HTMLElement, onExit?: (exitCode: number | null) => void): void
  unmount(host: HTMLElement): void
  show(): void
  hide(): void
  setFontSize(fontSize: number): void
}

// How many terminals keep a WebGL renderer. A WebKit page gets 16 live WebGL contexts and loses the
// oldest past that, and every terminal a reader has opened is now alive at once. The ones shown most
// recently keep theirs, so going back to the terminal you just left draws with no new context; the
// rest fall back to the DOM renderer while nobody looks at them and take a context again on the way
// back. Four covers flipping between a couple of tasks with a couple of tabs each.
export const WEBGL_TERMINALS = 4

type Renderer = { terminal: Terminal; addon: WebglAddon | null; shown: boolean }
// Most recently shown last.
const gpu: Renderer[] = []

function takeWebgl(renderer: Renderer): void {
  const at = gpu.indexOf(renderer)
  if (at >= 0) gpu.splice(at, 1)
  gpu.push(renderer)
  if (!renderer.addon) {
    // WebGL renderer: the DOM renderer draws box-drawing/block-element glyphs (U+2500-U+259F) from
    // the font, whose metrics leave gaps, and TUI logos and borders (Claude's banner) shatter into
    // stray bars and boxes. WebGL rasterizes those ranges as exact shapes. Must load after open().
    // On GPU context loss (sleep/reset, or the page's limit) dispose it and fall back to DOM rather
    // than freeze on a dead canvas; the next show asks for a new one.
    try {
      const addon = new WebglAddon()
      addon.onContextLoss(() => { if (renderer.addon === addon) dropWebgl(renderer) })
      renderer.terminal.loadAddon(addon)
      renderer.addon = addon
    } catch { /* no WebGL context (rare on a desktop) — DOM renderer still works, just fuzzier */ }
  }
  for (const oldest of gpu.slice(0, Math.max(0, gpu.length - WEBGL_TERMINALS))) {
    if (!oldest.shown) dropWebgl(oldest)
  }
}

function dropWebgl(renderer: Renderer): void {
  const at = gpu.indexOf(renderer)
  if (at >= 0) gpu.splice(at, 1)
  const addon = renderer.addon
  renderer.addon = null
  addon?.dispose()
}

/** How many terminals hold a WebGL context now. What the bound above is tested on. */
export const webglTerminalCount = (): number => gpu.filter((renderer) => renderer.addon).length

/**
 * The live xterm for a session on a node, built into `host` the first time. Built on the first frame a
 * surface is shown rather than when it mounts: a tab nobody has opened costs nothing, and xterm
 * measures its cell size from a laid-out element, which a `display: none` box is not.
 */
export function liveXterm(nodeId: string, sessionId: string, host: HTMLElement, fontSize: number): LiveXterm {
  return holdTerminal(nodeId, sessionId, () => buildXterm(nodeId, sessionId, host, fontSize))
}

function buildXterm(nodeId: string, sessionId: string, firstHost: HTMLElement, initialFontSize: number): LiveXterm {
  const api = terminalApi(nodeId || null)
  installScrollAreaGuard()
  let fontSize = initialFontSize
  // No convertEol: the PTY already emits CRLF for normal output (kernel ONLCR) and a full-screen
  // TUI (Claude/Codex) drives the cursor itself. Rewriting bare \n to \r\n injects stray carriage
  // returns that shift redraws to column 0, interleaving frames into garbage.
  const term = new Terminal({
    fontFamily: monoFont(),
    fontSize,
    lineHeight: TERMINAL_LINE_HEIGHT,
    theme: baseTheme(isAppDark()),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(firstHost)
  const renderer: Renderer = { terminal: term, addon: null, shown: false }
  let host: HTMLElement | null = firstHost
  let onExit: ((exitCode: number | null) => void) | undefined

  // fit() reaches into xterm's render service, which is torn down on dispose and momentarily
  // absent between a resize and the next paint. Guard so a ResizeObserver tick that lands during
  // teardown (or before the first paint) can't throw "reading 'dimensions' of undefined".
  let disposed = false
  const safeFit = () => { if (!disposed) { try { telemetry.measure('terminal.fit', () => fit.fit()) } catch { /* term detached mid-resize */ } } }
  safeFit()

  // Follows the app theme live (manual toggle or OS preference change). The resolved theme arrives
  // async, since its ANSI palette comes from Shiki, so this guards against applying to a term that
  // has since been disposed.
  //
  // Colours and type both matter: a style pack can move --font-mono's stack and --term-fs, which
  // changes the cell metrics, so this re-fits after applying, or the PTY keeps the old cols/rows
  // and the TUI wraps wrong. A terminal nobody is drawing takes the new options now and fits when
  // it is next shown.
  const applyAppearance = () => {
    if (disposed) return
    term.options.fontFamily = monoFont()
    term.options.fontSize = fontSize
    safeFit()
    void xtermTheme(isAppDark()).then((t) => { if (!disposed) term.options.theme = t })
  }
  applyAppearance()
  const unwatchAppearance = watchAppearance(applyAppearance)

  let pendingOutput = 0
  // The fitted size rides on the attach. The node sizes the PTY and its screen before it serializes
  // the snapshot, so the snapshot and later TUI redraws share this renderer's width. This used to be
  // a resize request, with the attach sent only once it answered, and on a task switch that request
  // queued behind every other one. A node older than the size field ignores it and reports the old
  // size in `ready`, so a mismatch there still posts the resize. A reconnect re-attaches and lands
  // here again.
  //
  // The attachment lasts as long as the xterm, drawn or not, so output keeps being parsed into it
  // while the reader is on another task. What that costs is the parse and nothing else: xterm's render
  // service pauses while its element is out of view.
  const detach = api.attach(sessionId, (m) => {
    if (disposed) return
    if (m.type === 'ready') {
      if (m.session.cols !== term.cols || m.session.rows !== term.rows) void api.resize(sessionId, term.cols, term.rows)
    }
    else if (m.type === 'output') {
      const size = m.data.length
      pendingOutput += size
      telemetry.observe('terminal.output.size', size)
      telemetry.observe('terminal.pending.size', pendingOutput)
      void telemetry.measure('terminal.write', () => new Promise<void>((resolve) => {
        term.write(m.data, () => { pendingOutput -= size; resolve() })
      }))
    }
    else if (m.type === 'exit') {
      term.write(`\r\n\x1b[90m[process exited${m.exitCode != null ? ` (${m.exitCode})` : ''}]\x1b[0m\r\n`)
      onExit?.(m.exitCode)
    }
  }, { cols: term.cols, rows: term.rows })
  // Shift+Enter → newline instead of submit. Terminals send CR (\r) for Enter and Claude submits
  // on CR; a bare LF (\n, same byte as Ctrl+J) is Claude's setup-free "insert newline". Swallow
  // the event so xterm doesn't also send the CR that would submit.
  term.attachCustomKeyEventHandler((e) => {
    if (disposed) return false
    if (e.type === 'keydown' && e.shiftKey && e.key === 'Enter') {
      e.preventDefault() // stop the browser inserting its own newline into xterm's textarea
      api.write(sessionId, '\n')
      return false
    }
    // Cmd chords belong to the app (pane shortcuts, Cmd+K, Cmd+comma, Cmd+Shift+N...), never the
    // PTY. Skip xterm's handling so they bubble to the window listeners. Ctrl/Alt chords stay
    // terminal input.
    if (e.type === 'keydown' && e.metaKey) return false
    return true
  })
  term.onData((d) => { if (!disposed) api.write(sessionId, d) })
  term.onResize(({ cols, rows }) => { if (!disposed) void api.resize(sessionId, cols, rows) })

  // Refit on any size change of the surface: drawer drag-resize, window resize, layout shifts. A
  // ResizeObserver catches the drawer-height change that window 'resize' would miss.
  const ro = new ResizeObserver(() => safeFit())
  ro.observe(firstHost)

  return {
    nodeId,
    sessionId,
    get mounted() { return host !== null },
    // A different surface's element: the drawer came back, on this task or after a switch. xterm
    // opens once, so the move is its element changing parents, and the observer follows it.
    mount(next, exit) {
      if (disposed) return
      onExit = exit
      if (host === next) return
      host = next
      if (term.element) next.append(term.element)
      ro.disconnect()
      ro.observe(next)
    },
    // Only the surface that holds the element gives it back: on a switch the new surface can mount
    // before the old one's cleanup runs. The element leaves the old one, so a parked xterm keeps no
    // reference into a view that has gone. It gives up focus first: WebKit remembers where a focused
    // element was removed from, and that would be a box in the view that has gone.
    unmount(from) {
      if (host !== from) return
      host = null
      onExit = undefined
      renderer.shown = false
      ro.disconnect()
      if (term.element?.contains(document.activeElement)) term.blur()
      term.element?.remove()
    },
    // Coming back into view. A hidden box has no dimensions, so `fit()` declines to resize while this
    // tab is away (@xterm/addon-fit returns early on a NaN proposal) and the ResizeObserver has
    // nothing useful to report either. One fit on the way back in covers whatever changed meanwhile,
    // and a changed size reaches the PTY through `onResize` above. The focus is what a reader who
    // clicked a tab is asking for.
    show() {
      if (disposed || !host) return
      renderer.shown = true
      takeWebgl(renderer)
      safeFit()
      term.focus()
    },
    hide() {
      renderer.shown = false
    },
    setFontSize(next) {
      fontSize = next
      if (disposed || term.options.fontSize === next) return
      term.options.fontSize = next
      safeFit()
    },
    dispose() {
      if (disposed) return
      disposed = true
      host = null
      onExit = undefined
      dropWebgl(renderer)
      detach()
      unwatchAppearance()
      ro.disconnect()
      term.dispose()
    },
  }
}
