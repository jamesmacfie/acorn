import { expect, it } from 'vitest'
import { dockerPaneContribution } from '../client/paneContribution'
import { dockerPlugin } from './index'

// The host can't see a built-in's client panes, so nothing else checks that Open in Acorn names a real one.
it("opens the browser panel's task on the Docker pane", () => {
  expect(dockerPlugin().browserPanel?.pane).toBe(dockerPaneContribution.id)
})
