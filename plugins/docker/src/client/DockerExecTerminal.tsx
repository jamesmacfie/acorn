// A minimal in-panel exec terminal: xterm over the docker:exec WS channel. Independent of the
// terminal plugin, which is a frozen boundary. @xterm/xterm is a shared npm dependency, and this PTY
// is throwaway: it dies with the panel or the connection, with no ring, no tmux, no persistence.
import { onCleanup, onMount } from 'solid-js'
import { Rectangle } from '@acorn/plugin-api/ui'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { wsDockerExecInput, wsDockerExecOpen, wsDockerExecResize } from './wsChannel'

export default function DockerExecTerminal(props: { containerRef: string; label: string }) {
  let host!: HTMLElement

  onMount(() => {
    const css = getComputedStyle(document.documentElement)
    const cssVar = (name: string) => css.getPropertyValue(name).trim() || undefined
    // Never set convertEol on a PTY-backed terminal: it garbles TUI frames.
    const term = new Terminal({
      fontSize: 12.5,
      theme: { background: cssVar('--bg'), foreground: cssVar('--text') },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const execId = crypto.randomUUID()
    const dispose = wsDockerExecOpen(execId, props.containerRef, term.cols, term.rows, (event) => {
      if (event.kind === 'out') term.write(event.data)
      else term.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n')
    })
    term.onData((data) => wsDockerExecInput(execId, data))

    const ro = new ResizeObserver(() => {
      fit.fit()
      wsDockerExecResize(execId, term.cols, term.rows)
    })
    ro.observe(host)
    term.focus()

    onCleanup(() => {
      ro.disconnect()
      dispose()
      term.dispose()
    })
  })

  // The kit owns the box and the way in and out of it with the keyboard; xterm owns what is inside.
  // `mount` is the element it attaches to, drawn by the host (ui/Rectangle.tsx).
  return <Rectangle kind="pty" label={props.label} mount={(element) => { host = element }} />
}
