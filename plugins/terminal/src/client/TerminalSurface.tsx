import { createEffect, onCleanup, untrack } from 'solid-js'
import { Rectangle } from '@acorn/plugin-api/ui'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { terminalApi } from './terminalClient'
import { baseTheme, monoFont, xtermTheme } from './theme'
import { isAppDark, watchAppearance } from '@acorn/plugin-api/client'
import { TERMINAL_LINE_HEIGHT } from './preferences'

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

// One xterm bound to one live session over WebSocket (docs/terminal.md). One per open tab, and it
// outlives a tab switch: the parent draws every session's surface and hides the ones nobody is looking
// at, so switching back is a repaint rather than a fresh xterm, a fresh WebGL context, a `term:attach`
// and a full framebuffer serialize on the node (docs/performance.md).
//
// The xterm is still built lazily, on the first frame this surface is shown on. Two reasons: a session
// nobody has opened yet costs nothing, and xterm measures its cell size from a laid-out element, which
// a `display: none` box is not. After that it stays until the tab closes for real.
export default function TerminalSurface(props: { sessionId: string; fontSize: number; hidden?: boolean; onExit?: (exitCode: number | null) => void }) {
  const api = terminalApi()
  let host!: HTMLElement
  let applyFontSize: ((fontSize: number) => void) | undefined
  let shown: (() => void) | undefined
  let teardown: (() => void) | undefined

  createEffect(() => {
    const fontSize = props.fontSize
    applyFontSize?.(fontSize)
  })

  // Built once, then re-fitted and re-focused every time this tab comes back. On the next frame,
  // because the `hidden` attribute is written by its own effect and xterm cannot measure a box that
  // is still display:none when this one runs.
  createEffect(() => {
    if (props.hidden) return
    // `props.hidden` is the only thing this effect follows. `start()` reads the font size and the
    // session id on its way past, and tracking those would rebuild nothing but would re-run `shown()`
    // — which focuses the terminal, so a font-size preference change would steal the caret.
    untrack(() => {
      teardown ??= start()
      requestAnimationFrame(() => shown?.())
    })
  })

  onCleanup(() => teardown?.())

  function start(): () => void {
    installScrollAreaGuard()
    // No convertEol: the PTY already emits CRLF for normal output (kernel ONLCR) and a full-screen
    // TUI (Claude/Codex) drives the cursor itself. Rewriting bare \n to \r\n injects stray carriage
    // returns that shift redraws to column 0, interleaving frames into garbage.
    const term = new Terminal({
      fontFamily: monoFont(),
      fontSize: props.fontSize,
      lineHeight: TERMINAL_LINE_HEIGHT,
      theme: baseTheme(isAppDark()),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    // WebGL renderer: the DOM renderer draws box-drawing/block-element glyphs (U+2500-U+259F) from
    // the font, whose metrics leave gaps, and TUI logos and borders (Claude's banner) shatter into
    // stray bars and boxes. WebGL rasterizes those ranges as exact shapes. Must load after open().
    // On GPU context loss (sleep/reset) dispose it and fall back to DOM rather than freeze on a
    // dead canvas.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch { /* no WebGL context (rare on a desktop) — DOM renderer still works, just fuzzier */ }
    // fit() reaches into xterm's render service, which is torn down on dispose and momentarily
    // absent between a resize and the next paint. Guard so a ResizeObserver tick that lands during
    // teardown (or before the first paint) can't throw "reading 'dimensions' of undefined".
    let disposed = false
    const safeFit = () => { if (!disposed) { try { fit.fit() } catch { /* term detached mid-resize */ } } }
    applyFontSize = (fontSize) => {
      if (disposed || term.options.fontSize === fontSize) return
      term.options.fontSize = fontSize
      safeFit()
    }
    safeFit()

    // Follows the app theme live (manual toggle or OS preference change). The resolved theme arrives
    // async, since its ANSI palette comes from Shiki, so this guards against applying to a term that
    // has since been disposed.
    //
    // Colours and type both matter: a style pack can move --font-mono's stack and --term-fs, which
    // changes the cell metrics, so this re-fits after applying, or the PTY keeps the old cols/rows
    // and the TUI wraps wrong.
    const applyAppearance = () => {
      if (disposed) return
      term.options.fontFamily = monoFont()
      term.options.fontSize = props.fontSize
      safeFit()
      void xtermTheme(isAppDark()).then((t) => { if (!disposed) term.options.theme = t })
    }
    applyAppearance()
    const unwatchAppearance = watchAppearance(applyAppearance)

    let detach: (() => void) | undefined
    // Size the PTY and main-owned framebuffer to the fitted dims before attaching, so the serialized
    // screen and subsequent TUI redraws share the renderer's width.
    void api.resize(props.sessionId, term.cols, term.rows).then(() => {
      if (disposed) return
      detach = api.attach(props.sessionId, (m) => {
        if (m.type === 'output') term.write(m.data)
        else if (m.type === 'exit') {
          term.write(`\r\n\x1b[90m[process exited${m.exitCode != null ? ` (${m.exitCode})` : ''}]\x1b[0m\r\n`)
          props.onExit?.(m.exitCode)
        }
      })
    })
    // Shift+Enter → newline instead of submit. Terminals send CR (\r) for Enter and Claude submits
    // on CR; a bare LF (\n, same byte as Ctrl+J) is Claude's setup-free "insert newline". Swallow
    // the event so xterm doesn't also send the CR that would submit.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.shiftKey && e.key === 'Enter') {
        e.preventDefault() // stop the browser inserting its own newline into xterm's textarea
        api.write(props.sessionId, '\n')
        return false
      }
      // Cmd chords belong to the app (pane shortcuts, Cmd+K, Cmd+comma, Cmd+Shift+N...), never the
      // PTY. Skip xterm's handling so they bubble to the window listeners. Ctrl/Alt chords stay
      // terminal input.
      if (e.type === 'keydown' && e.metaKey) return false
      return true
    })
    term.onData((d) => api.write(props.sessionId, d))
    term.onResize(({ cols, rows }) => void api.resize(props.sessionId, cols, rows))
    term.focus()

    // Refit on any size change of the surface: drawer drag-resize, window resize, layout shifts. A
    // ResizeObserver catches the drawer-height change that window 'resize' would miss.
    const ro = new ResizeObserver(() => safeFit())
    ro.observe(host)

    // Coming back into view. A hidden box has no dimensions, so `fit()` declines to resize while this
    // tab is away (@xterm/addon-fit returns early on a NaN proposal) and the ResizeObserver has
    // nothing useful to report either. One fit on the way back in covers whatever changed meanwhile,
    // and the focus is what a reader who clicked a tab is asking for.
    shown = () => {
      if (disposed) return
      safeFit()
      term.focus()
    }

    return () => {
      disposed = true
      applyFontSize = undefined
      shown = undefined
      detach?.()
      unwatchAppearance()
      ro.disconnect()
      term.dispose()
    }
  }

  // A PTY is pixels, so it is a rectangle rather than a tree: the kit owns the box and the way in and
  // out of it with the keyboard, and xterm owns everything inside (docs/terminal-and-agents.md §
  // Client). `mount` is the element xterm attaches to, drawn by the host, which is why this file spells
  // no element and carries no stylesheet.
  return <Rectangle kind="pty" label="Terminal" hidden={props.hidden} mount={(element) => { host = element }} />
}
