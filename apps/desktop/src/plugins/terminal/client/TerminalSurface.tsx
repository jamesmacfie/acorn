import { createEffect, onCleanup, onMount } from 'solid-js'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { terminalApi } from './terminalClient'
import { baseTheme, monoFont, xtermTheme } from './theme'
import { isAppDark, watchAppearance } from '../../../core/client/ui/appearance'
import { TERMINAL_LINE_HEIGHT } from './preferences'

// xterm 5.5.0 bug: disposing a terminal (workspace/tab switch, or a task finishing in another
// workspace and stealing focus) can leave a Viewport.syncScrollArea queued for the next frame. By
// the time it fires the render service's renderer is gone, so its `dimensions` getter reads
// `_renderer.value.dimensions` on undefined and throws. The terminal is dead and the scroll sync is
// a no-op — swallow exactly that stack (method names survive minification) and nothing else.
let scrollGuardInstalled = false
function installScrollAreaGuard() {
  if (scrollGuardInstalled || typeof window === 'undefined') return
  scrollGuardInstalled = true
  window.addEventListener('error', (e) => {
    if (e.error?.stack?.includes('syncScrollArea')) { e.preventDefault(); e.stopImmediatePropagation() }
  }, true)
}

// One xterm bound to one live session over WebSocket (docs/terminal-and-agents.md). Keyed by session id in the parent, so
// switching tabs unmounts this (detach, keep PTY running) and remounts a fresh xterm that replays
// the ring buffer. ponytail: local scrollback beyond the ring is lost on tab switch — fine for now.
export default function TerminalSurface(props: { sessionId: string; fontSize: number; onExit?: (exitCode: number | null) => void }) {
  const api = terminalApi()
  let host!: HTMLDivElement
  let applyFontSize: ((fontSize: number) => void) | undefined

  createEffect(() => {
    const fontSize = props.fontSize
    applyFontSize?.(fontSize)
  })

  onMount(() => {
    if (!api) return
    installScrollAreaGuard()
    // No convertEol: the PTY already emits CRLF for normal output (kernel ONLCR) and a full-screen
    // TUI (Claude/Codex) drives the cursor itself — rewriting bare \n to \r\n injects stray carriage
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
    // WebGL renderer: the DOM renderer draws box-drawing/block-element glyphs (U+2500–U+259F) from
    // the font, whose metrics leave gaps — TUI logos/borders (Claude's banner) shatter into stray
    // bars and boxes. WebGL rasterizes those ranges as exact shapes. Must load after open(). On GPU
    // context loss (sleep/reset) dispose it and fall back to DOM rather than freeze on a dead canvas.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch { /* no WebGL context (rare in Electron) — DOM renderer still works, just fuzzier */ }
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

    // Follow the app theme live (manual toggle or OS preference change). The full theme resolves
    // async (ANSI palette comes from the Shiki theme); guard against applying to a disposed term.
    // Colours AND type: a style pack can move --font-mono's stack and --term-fs, which changes the
    // cell metrics, so re-fit after applying or the PTY keeps the old cols/rows and the TUI wraps
    // wrong. The theme resolves async (the ANSI palette comes from Shiki); guard against a disposed
    // terminal.
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
    // Size the PTY to the fitted dims BEFORE attaching, so the replayed ring + repaint land at the
    // right width — a mismatched width reflows the replayed TUI frame into garbage.
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
      // ⌘ chords belong to the app (pane shortcuts, ⌘K, ⌘,, ⌘⇧N …), never the PTY — skip xterm's
      // handling so they bubble to the window listeners. Ctrl/Alt chords stay terminal input.
      if (e.type === 'keydown' && e.metaKey) return false
      return true
    })
    term.onData((d) => api.write(props.sessionId, d))
    term.onResize(({ cols, rows }) => void api.resize(props.sessionId, cols, rows))
    term.focus()

    // Refit on any size change of the surface — drawer drag-resize, window resize, layout shifts.
    // A ResizeObserver catches the drawer-height change that window 'resize' would miss.
    const ro = new ResizeObserver(() => safeFit())
    ro.observe(host)
    onCleanup(() => {
      disposed = true
      applyFontSize = undefined
      detach?.()
      unwatchAppearance()
      ro.disconnect()
      term.dispose()
    })
  })

  return <div class="terminal-surface" ref={host} />
}
