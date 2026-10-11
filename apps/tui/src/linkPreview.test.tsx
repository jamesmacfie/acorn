/** @jsxImportSource @acorn/tui/jsx */
import { afterEach, describe, expect, it } from 'vitest'
import { CORE_LINK_PREVIEW_POINT } from '@acorn/protocol/extensionPoints.ts'
import { extensionRegistry } from '@acorn/client-core/host/registries/extensionPoints/extensionPoints.ts'
import { closeLinkPreview, linkPreview, openLinkPreview } from '@acorn/client-core/host/linkPreview/linkPreview.ts'
import { renderFixture } from './harness'
import { Text } from './kit/showing'

// The terminal's link preview, on the real shell. A terminal has no hover, so the only way in is the
// link menu's Preview, which opens the same `core:link-preview` slot in a dialog.

const request = { url: 'https://docs.example.com/guide', label: 'The guide', scope: { taskId: 'task-1' }, focus: true }

afterEach(() => closeLinkPreview())

describe('link preview in the terminal', () => {
  it('draws the owner fallback with Open, and Escape closes it', async () => {
    const screen = await renderFixture({ width: 100, height: 30 })
    try {
      openLinkPreview(request)
      const frame = await screen.until('https://docs.example.com/guide')
      expect(frame).toContain('The guide')
      expect(frame).toContain('[Open]')
      await screen.press('ESCAPE')
      expect(linkPreview()).toBeNull()
    } finally {
      screen.done()
    }
  }, 30_000)

  it('draws the contributor that claims the site, and says whose it is', async () => {
    const contribution = extensionRegistry.register({
      id: 'fixture:docs-preview',
      pluginId: 'fixture',
      point: CORE_LINK_PREVIEW_POINT,
      label: 'Docs',
      order: 10,
      carrier: 'component',
      matches: ['https://docs.example.com/*'],
      component: (props: { url: string }) => <Text>{`Summary of ${props.url}`}</Text>,
    })
    const screen = await renderFixture({ width: 100, height: 30 })
    try {
      openLinkPreview(request)
      const frame = await screen.until('Summary of https://docs.example.com/guide')
      expect(frame).toContain('From fixture')
    } finally {
      screen.done()
      contribution.dispose()
    }
  }, 30_000)
})
