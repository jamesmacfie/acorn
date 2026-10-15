import { expect, it } from 'vitest'
import { createScreen } from './screen.mjs'

it('renders the active alternate screen and preserves dimensions on resize', async () => {
  const screen = createScreen(40, 24)
  try {
    await screen.write('old\x1b[?1049h\x1b[2J\x1b[HAcorn')
    expect((await screen.snapshot()).text).toContain('Acorn')
    expect((await screen.snapshot()).text).not.toContain('old')
    screen.resize(80, 24)
    expect(await screen.snapshot()).toMatchObject({ cols: 80, rows: 24 })
  } finally {
    screen.dispose()
  }
})

it('reads the screen as runs of cells in palette slots', async () => {
  const screen = createScreen(20, 2)
  try {
    await screen.write('\x1b[32mok\x1b[0m plain \x1b[1;91mbad\x1b[0m')
    const { columns, rows, lines } = await screen.cells()
    expect({ columns, rows }).toEqual({ columns: 20, rows: 2 })
    expect(lines).toEqual([
      [{ text: 'ok', fg: 'ok' }, { text: ' plain ' }, { text: 'bad', fg: 'danger', attrs: ['bold'] }],
      [],
    ])
  } finally {
    screen.dispose()
  }
})
