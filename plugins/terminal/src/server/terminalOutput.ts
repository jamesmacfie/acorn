// Loaded on first use (the `output` bridge method), so a Node boot doesn't carry it.
import { DISPLAY_SCROLLBACK_LINES, Terminal } from './terminalDisplay'

/**
 * The last `lines` lines of a session's output as plain text, the way the screen shows them: cursor
 * movement and colour applied, escape codes gone, and a line the terminal wrapped joined back into one.
 *
 * From a throwaway emulator over the raw ring, not the display's own, because the display only keeps
 * an emulator while an attach is waiting for one. `SerializeAddon` is no help here: it writes escape
 * codes so a client can repaint, and a model reading this wants the text.
 */
export async function outputText(history: string, cols: number, rows: number, lines: number): Promise<string> {
  const terminal = new Terminal({ cols, rows, scrollback: DISPLAY_SCROLLBACK_LINES, allowProposedApi: true })
  try {
    await new Promise<void>((resolve) => terminal.write(history, resolve))
    const buffer = terminal.buffer.active
    const joined: string[] = []
    for (let index = 0; index < buffer.length; index++) {
      const line = buffer.getLine(index)
      if (!line) continue
      const text = line.translateToString(true)
      if (line.isWrapped && joined.length) joined[joined.length - 1] += text
      else joined.push(text)
    }
    // The rows below the cursor are blank screen, not output.
    while (joined.length && !joined.at(-1)!.trim()) joined.pop()
    return joined.slice(-lines).join('\n')
  } finally {
    terminal.dispose()
  }
}
