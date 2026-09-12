import { onCleanup } from 'solid-js'
import type { PtyIo } from '@acorn/client-core/kit/lib/pty.ts'
import type { CellTerminal } from './rectangle'

// The terminal host's answer to "fill this `pty` rectangle", and the sibling of
// `client-core/features/terminal/attachPty.ts`.
//
// The DOM builds an xterm on an element; here the emulator is OpenTUI's and is already drawn, so this
// is only the plumbing between it and the channel the caller described. The caller's source is the same
// either way, which is the point: docker's exec panel and the editor's `$EDITOR` window are unchanged
// files that now work on a host with no browser in it
// (docs/tui.md § Rectangles).

export function attachPty(handle: unknown, io: PtyIo): void {
  const term = handle as CellTerminal
  // One decoder for the life of the attachment, so a character split across two keystrokes still
  // arrives whole. Bytes out are decoded to text because that is what every channel in the app takes,
  // and the emulator hands back what a PTY expects, which is bytes.
  const decoder = new TextDecoder()
  let dispose: (() => void) | undefined

  // Opening waits for a size: a PTY told its width late redraws a full-screen program at the wrong
  // one, and this box is usually holding vim. After that every report is a resize.
  const sized = (cols: number, rows: number): void => {
    if (cols <= 0 || rows <= 0) return
    if (dispose) {
      io.resize({ cols, rows })
      return
    }
    dispose = io.open({ cols, rows }, (event) => {
      if (event.kind === 'out') term.write(event.data)
      else if (io.farewell) term.write(`\r\n\x1b[2m${io.farewell}\x1b[0m\r\n`)
    })
  }

  term.onData((bytes) => io.input(decoder.decode(bytes, { stream: true })))
  term.onResize(sized)
  const { cols, rows } = term.size()
  sized(cols, rows)

  onCleanup(() => dispose?.())
}
