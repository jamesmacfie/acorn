import { describe, expect, it } from 'vitest'
import { menuPoint } from './menuPoint'

describe('icon context menu point', () => {
  it('uses the pointer for a right click and the focused icon for a keyboard event', () => {
    const icon = document.createElement('button')
    icon.getBoundingClientRect = () => ({ x: 20, y: 30, right: 68, top: 30, width: 48, height: 48 } as DOMRect)
    icon.addEventListener('contextmenu', (event) => {
      expect(menuPoint(event)).toEqual(event.clientX ? { x: 40, y: 50 } : { x: 68, y: 30 })
    })
    icon.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 50 }))
    icon.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
  })
})
