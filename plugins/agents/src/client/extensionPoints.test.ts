import { describe, expect, it } from 'vitest'
import {
  AGENT_ATTACHMENT_POINT,
  AGENT_COMPOSER_ACTIONS_POINT,
  AGENT_REQUEST_CARD_POINT,
  AGENT_SESSION_POINT,
  AGENT_TOOL_CARD_POINT,
} from '@acorn/protocol/extensionPoints.ts'
import { AGENT_ARTIFACT_POINT, AGENT_TRANSCRIPT_ATTACHMENT_POINT } from '../contract/transcriptMedia.ts'
import { agentPaneContribution, AGENT_PANE_ID } from './paneContribution'

// The places another plugin may come into this pane
// (docs/plugins/cooperative-extension-points.md § Cooperative extension points). Held in a test rather
// than only where they are drawn, because an unmatched contribution is silent by design: a point whose
// name drifted produces an empty surface and no error, and the two sides of the name are read from
// different manifests.
describe('the points the agents pane opens', () => {
  it("addresses each one under this plugin's own name, which the host mints", () => {
    expect(AGENT_TOOL_CARD_POINT).toBe('agents:tool-card')
    expect(AGENT_ATTACHMENT_POINT).toBe('agents:attachment')
    expect(AGENT_COMPOSER_ACTIONS_POINT).toBe('agents:composer-actions')
    expect(AGENT_REQUEST_CARD_POINT).toBe('agents:request-card')
    expect(AGENT_TRANSCRIPT_ATTACHMENT_POINT).toBe('agents:transcript-attachment')
    expect(AGENT_ARTIFACT_POINT).toBe('agents:artifact')
    expect(AGENT_SESSION_POINT).toBe('agents:session')
  })

  it('names the pane the same way the collection and the notice handler do', () => {
    for (const point of [
      AGENT_TOOL_CARD_POINT,
      AGENT_ATTACHMENT_POINT,
      AGENT_COMPOSER_ACTIONS_POINT,
      AGENT_REQUEST_CARD_POINT,
      AGENT_TRANSCRIPT_ATTACHMENT_POINT,
      AGENT_ARTIFACT_POINT,
      AGENT_SESSION_POINT,
    ]) {
      expect(point.split(':')[0]).toBe(AGENT_PANE_ID)
    }
  })
})

describe('the Agent pane', () => {
  // The regions are the layout's, and a name the layout does not have throws at registration rather
  // than at render (`regionProblem`). Asserted here so a rename is caught by this
  // suite instead of by opening the pane.
  it('is a list-detail layout with a header over its list', () => {
    expect(agentPaneContribution.layout).toBe('list-detail')
    expect(Object.keys(agentPaneContribution.regions).sort()).toEqual(['detail', 'list', 'list-header'])
  })
})
