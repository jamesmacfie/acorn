/** @jsxImportSource @acorn/tui/jsx */
import { afterEach, describe, expect, it } from 'vitest'
import { paletteFor, setPalette, TERMINAL_PALETTE } from '../appearance'
import type { Color } from '../colour'
import { cellAt, type Buffer } from '../paint/buffer'
import { HeaderBodyFooter } from '../layouts/HeaderBodyFooter'
import { renderCells, type Cells } from './render'
import { Row, Rows } from './showing'

// The row the keys are on takes the theme's selected background across its whole width, and the
// open row takes the lighter one, as the desktop's rows do (./showing/row.tsx).

const SELECTED: Color = [0x44, 0x47, 0x5a]
const HOVER: Color = [0x34, 0x37, 0x46]

/** The background at the far end of the line that says `text`, inside the pane's border and the
 *  scrollbar's column. */
const fillOf = (screen: Cells, text: string): Color => {
  const buffer = (screen.renderer as unknown as { screen: { screen: () => Buffer } }).screen.screen()
  const y = screen.lines.findIndex((line) => line.includes(text))
  return cellAt(buffer, buffer.cols - 3, y)!.bg
}

describe('a row', () => {
  afterEach(() => setPalette(TERMINAL_PALETTE))

  it('fills the row the keys are on, and the open row more lightly', async () => {
    setPalette(paletteFor({ '--bg-selected': '#44475a', '--bg-hover': '#343746' }, true))
    const screen = await renderCells(
      () => (
        <HeaderBodyFooter
          stateKey="fill"
          label="Fill"
          regions={{
            body: () => (
              <Rows
                id="fill"
                items={[
                  { key: 'a', label: 'alpha' },
                  { key: 'b', label: 'beta' },
                ]}
              >
                {(item, itemProps) => (
                  <Row item={itemProps} selected={item.key === 'b'}>
                    {item.label}
                  </Row>
                )}
              </Rows>
            ),
          }}
        />
      ),
      { width: 30, height: 6 },
    )
    try {
      expect(screen.lines.find((line) => line.includes('›'))).toContain('alpha')
      expect(fillOf(screen, 'alpha')).toEqual(SELECTED)
      expect(fillOf(screen, 'beta')).toEqual(HOVER)

      // The keys move onto the open row, and the strong fill goes with them.
      const moved = await screen.press('ARROW_DOWN')
      expect(fillOf(moved, 'alpha')).toBe('default')
      expect(fillOf(moved, 'beta')).toEqual(SELECTED)
    } finally {
      screen.done()
    }
  })

  it('keeps the terminal background where the theme gives no colour', async () => {
    const screen = await renderCells(() => <Row selected>alpha</Row>)
    try {
      expect(fillOf(screen, 'alpha')).toBe('default')
    } finally {
      screen.done()
    }
  })
})
