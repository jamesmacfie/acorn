import headless from '@xterm/headless'

const { Terminal } = headless

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
    dispose() { terminal.dispose() },
  }
}
