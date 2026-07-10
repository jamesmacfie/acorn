import { createRoot } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { createOverlayPalette } from './overlay'

describe('overlay palette focus ownership', () => {
  it('keeps the input focused when palette chrome is clicked', () => {
    createRoot((dispose) => {
      const palette = createOverlayPalette({ count: () => 0, onPick: () => undefined })
      const input = { focus: vi.fn() } as unknown as HTMLInputElement
      const preventDefault = vi.fn()
      palette.setInputRef(input)

      palette.onDialogMouseDown({ target: {}, preventDefault } as unknown as MouseEvent)

      expect(preventDefault).toHaveBeenCalledOnce()
      expect(input.focus).toHaveBeenCalledOnce()
      dispose()
    })
  })

  it('preserves native mouse behavior inside the input', () => {
    createRoot((dispose) => {
      const palette = createOverlayPalette({ count: () => 0, onPick: () => undefined })
      const input = { focus: vi.fn() } as unknown as HTMLInputElement
      const preventDefault = vi.fn()
      palette.setInputRef(input)

      palette.onDialogMouseDown({ target: input, preventDefault } as unknown as MouseEvent)

      expect(preventDefault).not.toHaveBeenCalled()
      expect(input.focus).not.toHaveBeenCalled()
      dispose()
    })
  })
})
