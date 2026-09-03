/** @jsxImportSource @opentui/solid */
import { createComponent } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { canDraw } from './ffi'
import { bootFixture } from './harness'
import { renderCells } from './kit/render'
import type { Cells } from './kit/render'
import { regionFocus } from './keys/regions'

// The title filter on a descriptor source's list (./plugins/SourcePanel.tsx).
//
// Its own file, and drawn as one region rather than through the whole shell, because nothing that
// contributes a source *by descriptor* is wired into this host's fixture: no connection, no roster
// entry, no chrome contribution. Building one to reach the panel would make the test a plugin
// integration first and an assertion second, which is the call phase 3 already made about a Linear
// case. So the panel is asked for directly, the way `plugins/plugins.test.tsx` asks for it, and it is
// drawn inside a region so that the two walks the filter uses — Down into the rows and Escape out of
// the panel — have a region to walk (../keys/regions.ts § moveStop).

const caretLine = (screen: Cells): string => screen.lines.find((line) => line.includes('›')) ?? ''

describe.skipIf(!canDraw)('a descriptor source list', () => {
  it('filters by title on / and gives the rows back on escape', async () => {
    await bootFixture()
    const { sourcePanel } = await import('./plugins/SourcePanel')
    const descriptor = {
      id: 'items', label: 'Issues', glyph: 'circle', order: 10, items: '/v2/p/probe/items',
    } as unknown as Parameters<typeof sourcePanel>[0]['descriptor']
    const list = sourcePanel({ pluginId: 'probe', descriptor }).regions!.list

    let screen = await renderCells(() => (
      <box
        flexDirection="column"
        flexGrow={1}
        ref={regionFocus({ paneId: 'chrome', regionId: 'browse' }, 0)}
      >
        {createComponent(list, {})}
      </box>
    ), { width: 44, height: 12 })
    try {
      // The fan-out answers off a tick, not off a frame, so wait for the rows rather than flushing.
      for (let turn = 0; turn < 40 && !screen.text.includes('Rotate'); turn += 1) {
        await new Promise((done) => setTimeout(done, 100))
        screen = await screen.frame()
      }
      expect(screen.text).toContain('Rotate the signing key')
      expect(screen.text).toContain('Password reset copy')

      // `/` puts the keys in the field, and what is typed narrows the list. The caret leaves the rows
      // while it does, which is what tells a reader the letters are going somewhere.
      screen = await screen.press('/')
      for (const letter of 'rotate') screen = await screen.press(letter)
      expect(screen.text).toContain('Rotate the signing key')
      expect(screen.text).not.toContain('Password reset copy')

      // Escape leaves the field for the rows below it.
      screen = await screen.press('ESCAPE')
      expect(caretLine(screen)).toContain('Rotate the signing key')
    } finally {
      screen.done()
    }
  }, 60_000)
})
