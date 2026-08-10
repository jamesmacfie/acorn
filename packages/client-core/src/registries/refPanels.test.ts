import { afterEach, describe, expect, it } from 'vitest'
import { activeRefPanel, closeRefPanel, openRefPanel, refPanelRegistry } from './refPanels'

// The single-slot shell state, and the one function allowed to write it.
//
// `setOpenRef` is deliberately not exported: a panel with no subject has a dismiss button and nothing
// else, so "can this be shown at all" is a decision rather than a setter. The suite pins the refusals
// because they are what a content-link recogniser — plugin-supplied code returning an open record — is
// checked against.
//
// What this suite CANNOT reach is the other half of the same failure: the props the host hands the
// panel component. That is JSX, client-core's vitest config has no Solid transform on purpose, and the
// defect that produced a blank panel in the app lived precisely there — a props member named `ref`,
// which Solid compiles into a setter. tools/arch/boundaries.test.ts holds that line instead, and the
// two together are the whole invariant.

afterEach(closeRefPanel)

describe('openRefPanel', () => {
  it('shows a ref whose provider has a panel registered here', () => {
    const panel = refPanelRegistry.register({ id: 'board-ref', providerId: 'board', component: () => null })

    expect(openRefPanel({ providerId: 'board', displayId: 'ENG-42' })).toBe(true)
    expect(activeRefPanel()).toEqual({ providerId: 'board', displayId: 'ENG-42' })

    panel.dispose()
  })

  it('refuses a ref with no displayId rather than opening an overlay with no subject', () => {
    const panel = refPanelRegistry.register({ id: 'board-ref', providerId: 'board', component: () => null })

    // The shape a recogniser produces when its captured segment is missing or empty. There is nothing
    // for the panel to render and nothing for its header to say, so this is not a state to present.
    expect(openRefPanel({ providerId: 'board', displayId: '' })).toBe(false)
    expect(activeRefPanel()).toBeNull()

    panel.dispose()
  })

  it('refuses a provider this device has no panel for, and leaves the previous panel alone', () => {
    const panel = refPanelRegistry.register({ id: 'board-ref', providerId: 'board', component: () => null })
    openRefPanel({ providerId: 'board', displayId: 'ENG-42' })

    // A refused open is not a close. The caller's next rung (the task pane) or the real URL is still
    // there, and the reader keeps what they were looking at either way.
    expect(openRefPanel({ providerId: 'not-installed', displayId: 'ENG-9' })).toBe(false)
    expect(activeRefPanel()).toEqual({ providerId: 'board', displayId: 'ENG-42' })

    panel.dispose()
  })

  it('replaces the open panel rather than stacking a second one', () => {
    const panel = refPanelRegistry.register({ id: 'board-ref', providerId: 'board', component: () => null })
    openRefPanel({ providerId: 'board', displayId: 'ENG-42' })

    expect(openRefPanel({ providerId: 'board', displayId: 'ENG-43' })).toBe(true)
    expect(activeRefPanel()).toEqual({ providerId: 'board', displayId: 'ENG-43' })

    panel.dispose()
  })
})
