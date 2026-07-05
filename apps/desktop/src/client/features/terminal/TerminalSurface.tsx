import { onCleanup, onMount } from 'solid-js'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { terminalApi } from './terminalClient'
import { isAppDark, monoFont, watchTheme, xtermTheme } from './theme'

// One xterm bound to one live session over IPC (vNext §5). Keyed by session id in the parent, so
// switching tabs unmounts this (detach, keep PTY running) and remounts a fresh xterm that replays
// the ring buffer. ponytail: local scrollback beyond the ring is lost on tab switch — fine for now.
export default function TerminalSurface(props: { sessionId: string; onExit?: (exitCode: number | null) => void }) {
  const api = terminalApi()
  let host!: HTMLDivElement

  onMount(() => {
    if (!api) return
    const term = new Terminal({ convertEol: true, fontFamily: monoFont(), fontSize: 13, theme: xtermTheme(isAppDark()) })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    // Follow the app's light/dark theme live (manual toggle or OS preference change).
    const unwatchTheme = watchTheme(() => (term.options.theme = xtermTheme(isAppDark())))

    const detach = api.attach(props.sessionId, (m) => {
      if (m.type === 'output') term.write(m.data)
      else if (m.type === 'exit') {
        term.write(`\r\n\x1b[90m[process exited${m.exitCode != null ? ` (${m.exitCode})` : ''}]\x1b[0m\r\n`)
        props.onExit?.(m.exitCode)
      }
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
    void api.resize(props.sessionId, term.cols, term.rows)
    term.focus()

    // Refit on any size change of the surface — drawer drag-resize, window resize, layout shifts.
    // A ResizeObserver catches the drawer-height change that window 'resize' would miss.
    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(host)
    onCleanup(() => {
      detach()
      unwatchTheme()
      ro.disconnect()
      term.dispose()
    })
  })

  return <div class="terminal-surface" ref={host} />
}
