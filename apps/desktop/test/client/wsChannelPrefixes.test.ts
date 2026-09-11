import { describe, expect, it } from 'vitest'
import { wsChannelPrefixes } from '@acorn/client-core/infra/node/wsChannels.ts'

// A wrong prefix is a silent drop now, where the old if/else chain in wsClient.ts at least had a dead
// branch to read. This pins the set after the shell's plugins have registered, so a channel that stops
// being claimed (a typo, or a plugin whose client half forgot to register) fails here rather than
// showing up as a pane that never updates.
//
// Importing activate.ts boots the graph; the assertion is on what claimed a prefix.
describe('registered ws channel prefixes', () => {
  it('are exactly the eighteen the app expects', async () => {
    await import('../../src/client/activate')
    // term, workflow, plugins, tasks, connection, head, run, agent-session, project, terminal,
    // workspace, workspace-projects, worktree and ws are core's (client-core/infra/node/wsClient.ts):
    // term is transport on both ends,
    // workflow:notice feeds core's notification pipeline, `ws:shed` is the hub apologising for frames it
    // dropped under load, and the rest are the node announcing one of its own facts moved
    // (docs/plugins.md § Hearing a core event). `terminal` and `worktree` are the two halves the old
    // content-free `term:status` ping was split into
    // (docs/performance.md § 2026-09-03 — phase 5). `agent-session` rather than `agent` because the latter is
    // the agents plugin's own prefix. `plugin` — singular,
    // one letter from `plugins` and deliberately distinct — is the namespace core claims for every
    // loaded plugin's own live channel (client-core/host/plugins/pluginChannel.ts). docker, editor and agent are
    // their plugins'. `editor` is the editor pane's `$EDITOR`-in-a-PTY handoff.
    expect(wsChannelPrefixes()).toEqual(['agent', 'agent-session', 'connection', 'docker', 'editor', 'head', 'plugin', 'plugins', 'project', 'run', 'tasks', 'term', 'terminal', 'workflow', 'workspace', 'workspace-projects', 'worktree', 'ws'])
  })
})
