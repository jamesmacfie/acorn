import { describe, expect, it } from 'vitest'
import type { BridgeHandoff } from '@acorn/protocol/extensionBridge.ts'
import { onHandoffPage } from './handoffs'

const declared = {
  pluginId: 'github',
  id: 'pull-request',
  match: ['https://github.com/{owner}/{repo}/pull/{number}', 'https://github.com/{owner}/{repo}/pull/{number}/{tab}'],
} as BridgeHandoff
const asked = {
  pluginId: 'github',
  handoffId: 'pull-request',
  label: 'Open in Acorn',
  url: 'https://github.com/acme/widget/pull/42',
}

describe('onHandoffPage', () => {
  it("keeps the item across its own tabs and leaves it for another item's page", () => {
    expect(onHandoffPage([declared], asked, 'https://github.com/acme/widget/pull/42/files')).toBe(true)
    expect(onHandoffPage([declared], { ...asked, url: `${asked.url}/files` }, asked.url)).toBe(true)
    expect(onHandoffPage([declared], asked, 'https://github.com/acme/widget/pull/43')).toBe(false)
    expect(onHandoffPage([declared], asked, 'https://github.com/acme/widget')).toBe(false)
    expect(onHandoffPage([declared], asked, undefined)).toBe(false)
  })

  it('says no once the Node no longer declares the handoff', () => {
    expect(onHandoffPage([], asked, asked.url)).toBe(false)
  })
})
