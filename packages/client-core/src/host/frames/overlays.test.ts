import { describe, expect, it } from 'vitest'
import {
  closePluginOverlay,
  closePluginOverlayFrom,
  closePluginOverlayWith,
  openPluginOverlay,
  openPluginOverlayInvocation,
  pluginOverlayInvocation,
  pluginOverlayOpen,
} from './overlays'

// One overlay at a time, and exactly one answer per opening (docs/plugins.md § Companion overlays).
//
// The property worth a suite is that nobody is ever left waiting. An overlay can be dismissed six ways
// and answered one, and a remote tree awaiting `openOverlay` has to be resolved by every one of them —
// otherwise a reader who presses Escape leaves a promise, and whatever the tree was doing while it
// waited never finishes.

describe('opening an overlay', () => {
  it('says which surface is up, so the slot that draws it can', () => {
    openPluginOverlay('files', 'palette')
    expect(pluginOverlayOpen('files', 'palette')).toBe(true)
    expect(pluginOverlayOpen('files', 'other')).toBe(false)
    expect(pluginOverlayOpen('notes', 'palette')).toBe(false)
    closePluginOverlay()
    expect(pluginOverlayOpen('files', 'palette')).toBe(false)
  })

  it('carries the opener’s input, which is the whole reason a command could not do this', () => {
    openPluginOverlayInvocation({ pluginId: 'markup', surface: 'editor', input: { attachmentId: 'a1' } })
    expect(pluginOverlayInvocation()?.input).toEqual({ attachmentId: 'a1' })
  })

  it('gives each opening its own id, so reopening builds a fresh frame rather than reusing a canvas', () => {
    const first = openPluginOverlayInvocation({ pluginId: 'markup', surface: 'editor' })
    const second = openPluginOverlayInvocation({ pluginId: 'markup', surface: 'editor' })
    expect(second.id).not.toBe(first.id)
    expect(pluginOverlayInvocation()?.id).toBe(second.id)
  })

  it('resolves with what the frame closed with', async () => {
    const opened = openPluginOverlayInvocation({ pluginId: 'markup', surface: 'editor' })
    closePluginOverlayWith({ replacementAttachmentId: 'a2' })
    await expect(opened.result).resolves.toEqual({ replacementAttachmentId: 'a2' })
  })

  it('resolves with null on a plain dismissal, so an opener need not tell cancelled from gone', async () => {
    const opened = openPluginOverlayInvocation({ pluginId: 'markup', surface: 'editor' })
    closePluginOverlay()
    await expect(opened.result).resolves.toBeNull()
  })

  it('settles the first when a second opens over it', async () => {
    const first = openPluginOverlayInvocation({ pluginId: 'markup', surface: 'editor' })
    openPluginOverlayInvocation({ pluginId: 'markup', surface: 'editor' })
    await expect(first.result).resolves.toBeNull()
  })

  // A command opening one counts: the ⌘P palette covering an editor is the same "the reader is looking
  // at something else now" that a second editor is.
  it('settles when a command opens an overlay over it', async () => {
    const opened = openPluginOverlayInvocation({ pluginId: 'markup', surface: 'editor' })
    openPluginOverlay('files', 'palette')
    await expect(opened.result).resolves.toBeNull()
  })

  it('settles once, so a frame that answers on its way out cannot resolve twice', async () => {
    const opened = openPluginOverlayInvocation({ pluginId: 'markup', surface: 'editor' })
    closePluginOverlayWith('answered')
    closePluginOverlay()
    await expect(opened.result).resolves.toBe('answered')
  })

  // The tree unmounting: the composer navigated away, or the attachment was removed.
  it('lets an opener dismiss its own invocation and nobody else’s', async () => {
    const first = openPluginOverlayInvocation({ pluginId: 'markup', surface: 'editor' })
    closePluginOverlayFrom(first.id)
    await expect(first.result).resolves.toBeNull()

    const second = openPluginOverlayInvocation({ pluginId: 'markup', surface: 'editor' })
    closePluginOverlayFrom(first.id)
    expect(pluginOverlayInvocation()?.id).toBe(second.id)
    closePluginOverlay()
  })
})
