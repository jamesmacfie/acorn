import headless from '@xterm/headless'

const { Terminal } = headless

// The terminal's numbered colors as the palette slots the TUI draws in (src/appearance.ts), and 9 to
// 14 as the bright forms of 1 to 6. The site paints each slot from the visitor's theme
// (docs/site/specimens.md).
const SLOTS = { 1: 'danger', 2: 'ok', 3: 'warn', 4: 'accent', 5: 'accent', 6: 'accent', 8: 'muted' }
const slotOf = (isPalette, color) => (isPalette ? (SLOTS[color] ?? SLOTS[color - 8]) : undefined)

/** One cell's look, in the specimen cell format: a run carries its text and only what isn't default. */
function lookOf(cell) {
  const attrs = [
    cell.isBold() && 'bold',
    cell.isDim() && 'dim',
    cell.isUnderline() && 'underline',
    cell.isInverse() && 'inverse',
  ].filter(Boolean)
  const fg = slotOf(cell.isFgPalette(), cell.getFgColor())
  const bg = slotOf(cell.isBgPalette(), cell.getBgColor())
  return { ...(fg ? { fg } : {}), ...(bg ? { bg } : {}), ...(attrs.length ? { attrs } : {}) }
}

export function createScreen(cols, rows) {
  const terminal = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 1000 })
  let pending = Promise.resolve()
  let revision = 0
  return {
    write(output) {
      pending = pending.then(() => new Promise((resolve) => terminal.write(output, resolve)))
      revision += 1
      return pending
    },
    resize(nextCols, nextRows) {
      terminal.resize(nextCols, nextRows)
      revision += 1
    },
    async snapshot() {
      await pending
      const buffer = terminal.buffer.active
      const lines = Array.from({ length: terminal.rows }, (_, row) =>
        buffer.getLine(buffer.viewportY + row)?.translateToString(false, 0, terminal.cols) ?? '')
      return { cols: terminal.cols, rows: terminal.rows, lines, text: lines.map((line) => line.trimEnd()).join('\n'), revision }
    },
    /** The visible screen as runs of cells that look alike, one array per row, with each row's trailing
     *  blank cells left off. */
    async cells() {
      await pending
      const buffer = terminal.buffer.active
      const cell = buffer.getNullCell()
      const lines = Array.from({ length: terminal.rows }, (_, row) => {
        const line = buffer.getLine(buffer.viewportY + row)
        const runs = []
        let previous = null
        for (let column = 0; column < terminal.cols; column += 1) {
          line?.getCell(column, cell)
          if (cell.getWidth() === 0) continue
          const look = JSON.stringify(lookOf(cell))
          const text = cell.getChars() || ' '
          if (look === previous) runs.at(-1).text += text
          else runs.push({ text, ...JSON.parse(look) })
          previous = look
        }
        const last = runs.at(-1)
        if (last && Object.keys(last).length === 1) last.text = last.text.trimEnd()
        return runs.filter((run) => run.text !== '')
      })
      return { columns: terminal.cols, rows: terminal.rows, lines }
    },
    dispose() { terminal.dispose() },
  }
}
