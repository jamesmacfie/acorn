// The file, open in the reader's own editor. An xterm over the editor:pty channel, in the kit's PTY
// rectangle — the same shape docker's exec terminal has, and throwaway for the same reason: it lives
// as long as the file is open in terminal mode, with no session row, no tmux and no drawer tab.
import { onCleanup, onMount } from 'solid-js'
import { Rectangle } from '@acorn/plugin-api/ui'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { wsEditorPtyInput, wsEditorPtyOpen, wsEditorPtyResize } from './wsChannel'

export default function EditorTerminal(props: { taskId: string; path: string; onExit: (code: number) => void }) {
  let host!: HTMLElement

  onMount(() => {
    const css = getComputedStyle(document.documentElement)
    const cssVar = (name: string) => css.getPropertyValue(name).trim() || undefined
    // Never set convertEol on a PTY-backed terminal: it garbles TUI frames, and vim is one.
    const term = new Terminal({
      fontSize: 12.5,
      theme: { background: cssVar('--bg'), foreground: cssVar('--text') },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const ptyId = crypto.randomUUID()
    const dispose = wsEditorPtyOpen(ptyId, props.taskId, props.path, term.cols, term.rows, (event) => {
      if (event.kind === 'out') term.write(event.data)
      else props.onExit(event.code)
    })
    term.onData((data) => wsEditorPtyInput(ptyId, data))

    const ro = new ResizeObserver(() => {
      fit.fit()
      wsEditorPtyResize(ptyId, term.cols, term.rows)
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
  return <Rectangle kind="pty" label={`Editing ${props.path}`} mount={(element) => { host = element }} />
}
