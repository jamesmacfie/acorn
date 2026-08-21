import { describe, expect, it } from 'vitest'
import { wsChannelPrefixes } from '@acorn/client-core/wsChannels.ts'

// A wrong prefix is a silent drop now, where the old if/else chain in wsClient.ts at least had a dead
// branch to read. This pins the set after the shell's plugins have registered, so a channel that stops
// being claimed (a typo, or a plugin whose client half forgot to register) fails here rather than
// showing up as a pane that never updates.
//
// Importing activate.ts boots the graph; the assertion is on what claimed a prefix.
describe('registered ws channel prefixes', () => {
  it('are exactly the six the app expects', async () => {
    await import('../../src/app/client/activate')
    // term, workflow and plugins are core's (client-core/wsClient.ts): term is transport on both ends,
    // workflow:notice feeds core's notification pipeline, and plugins:changed is the node telling the
    // shell its plugin set moved. `plugin` — singular, one letter from `plugins` and deliberately
    // distinct — is the namespace core claims for every loaded plugin's own live channel
    // (client-core/plugins/pluginChannel.ts). docker and agent are their plugins'.
    expect(wsChannelPrefixes()).toEqual(['agent', 'docker', 'plugin', 'plugins', 'term', 'workflow'])
  })
})
