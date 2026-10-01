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
