import { onCleanup, onMount } from 'solid-js'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { terminalApi } from './terminalClient'
import { baseTheme, isAppDark, monoFont, watchTheme, xtermTheme } from './theme'

// One xterm bound to one live session over WebSocket (docs/terminal-and-agents.md). Keyed by session id in the parent, so
// switching tabs unmounts this (detach, keep PTY running) and remounts a fresh xterm that replays
// the ring buffer. ponytail: local scrollback beyond the ring is lost on tab switch — fine for now.
export default function TerminalSurface(props: { sessionId: string; onExit?: (exitCode: number | null) => void }) {
  const api = terminalApi()
  let host!: HTMLDivElement

  onMount(() => {
    if (!api) return
    // No convertEol: the PTY already emits CRLF for normal output (kernel ONLCR) and a full-screen
    // TUI (Claude/Codex) drives the cursor itself — rewriting bare \n to \r\n injects stray carriage
    // returns that shift redraws to column 0, interleaving frames into garbage.
    const term = new Terminal({ fontFamily: monoFont(), fontSize: 13, theme: baseTheme(isAppDark()) })
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
    safeFit()

    // Follow the app theme live (manual toggle or OS preference change). The full theme resolves
    // async (ANSI palette comes from the Shiki theme); guard against applying to a disposed term.
    const applyTheme = () => void xtermTheme(isAppDark()).then((t) => { if (!disposed) term.options.theme = t })
    applyTheme()
    const unwatchTheme = watchTheme(applyTheme)

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
      detach?.()
      unwatchTheme()
      ro.disconnect()
      term.dispose()
    })
  })

  return <div class="terminal-surface" ref={host} />
}
