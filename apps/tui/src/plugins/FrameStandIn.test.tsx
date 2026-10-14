/** @jsxImportSource @acorn/tui/jsx */
import { expect, test } from 'vitest'
import type { FrameBinding } from '@acorn/client-core/host/frames/broker.ts'
import { renderCells } from '../kit/render'
import { FrameStandIn } from './FrameStandIn'

// What this host draws where a loaded plugin asked for a frame (client-core host/frames/frameSurface.ts).

const binding = { pluginId: 'machine-stats', surface: 'stats', target: 'pane' } as FrameBinding

test('a frame draws one line naming the plugin', async () => {
  const screen = await renderCells(() => <FrameStandIn binding={binding} hash="a" />, { width: 120 })
  const drawn = await screen.frame()
  screen.done()

  expect(drawn.text).not.toContain('Unknown component type')
  expect(drawn.text).toContain("machine-stats draws this view as a web page, which the terminal can't show.")
})

test('a controller-only frame draws nothing, as on the desktop', async () => {
  const screen = await renderCells(() => <FrameStandIn binding={binding} hash="a" controllerOnly />, { width: 120 })
  const drawn = await screen.frame()
  screen.done()

  expect(drawn.text).not.toContain('web page')
})
