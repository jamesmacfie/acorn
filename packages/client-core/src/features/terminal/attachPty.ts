import { onCleanup } from 'solid-js'
import type { PtyIo } from '../../kit/lib/pty'

// The DOM host's answer to "fill this `pty` rectangle": an xterm on the element the rectangle drew,
// bound to the channel the caller described (../../kit/lib/pty.ts).
//
// Here rather than in `kit/` because it carries xterm and a stylesheet, and the kit may import neither
// (docs/frontend.md § Registries and plugins). Reached by a plugin through `@acorn/plugin-api/ui`,
// which is where every other host-owned rule on the compiled surface already is.
//
// It exists because three plugins were each doing this — the editor's `$EDITOR` window and docker's
// exec panel, both throwaway, and the terminal drawer's own surface, which is not throwaway and keeps
// its own copy for the options it needs. The two throwaway ones are now one function, and the same
// function has a sibling in the terminal client that draws in cells instead
// (apps/tui/src/kit/pty.ts). That is what let the editor handoff and docker exec cross to a host with
// no browser in it (docs/terminal.md § Client).
//
// xterm arrives through a dynamic import, which is what the two callers used to get from `lazy()`
// around their own components: it reads `self` at module scope, so a static import here would put it
// in the eager graph of every consumer of this barrel and take the desktop's own boot tests down.

/** Attach the caller's PTY to the element a `pty` rectangle handed over. Call it from `mount`. */
export function attachPty(handle: unknown, io: PtyIo): void {
  const host = handle as HTMLElement
  let teardown: (() => void) | undefined
  let gone = false

  void (async () => {
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/xterm/css/xterm.css'),
    ])
    if (gone) return
    // Never `convertEol` on a PTY-backed terminal: the PTY already emits CRLF for ordinary output and
    // a full-screen program drives the cursor itself, so rewriting a bare newline interleaves its
    // frames into garbage. vim is one of those programs and this box is usually holding it.
    const css = getComputedStyle(document.documentElement)
    const cssVar = (name: string) => css.getPropertyValue(name).trim() || undefined
    const term = new Terminal({
      fontSize: 12.5,
      theme: { background: cssVar('--bg'), foreground: cssVar('--text') },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const dispose = io.open({ cols: term.cols, rows: term.rows }, (event) => {
      if (event.kind === 'out') term.write(event.data)
      else if (io.farewell) term.write(`\r\n\x1b[2m${io.farewell}\x1b[0m\r\n`)
    })
    term.onData((data: string) => io.input(data))

    const observer = new ResizeObserver(() => {
      fit.fit()
      io.resize({ cols: term.cols, rows: term.rows })
    })
    observer.observe(host)
    term.focus()

    teardown = () => {
      observer.disconnect()
      dispose()
      term.dispose()
    }
  })()

  onCleanup(() => {
    gone = true
    teardown?.()
  })
}
