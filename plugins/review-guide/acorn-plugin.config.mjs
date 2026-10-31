// The loadable-package declaration for this plugin, which `apps/node/scripts/build-plugin.mjs` reads to
// build the bundles and write `acorn-plugin.json` (docs/first-party-plugins/review-guide.md).
export default {
  name: 'Review guide',
  entry: '@acorn/plugin-review-guide/node/index.ts',
  factory: 'reviewGuidePlugin',
  client: { entry: './src/tree/index.tsx' },
  // `plugins/review-guide/migrations` is the source of truth, and drizzle-kit generates into it.
  migrations: './migrations',
  // The two capabilities below are the Agents plugin's.
  requires: { plugins: [{ id: 'agents' }] },
  permissions: {
    // A hunk's link opens the task's change request diff at its first line.
    api: ['core.changeRequests:reveal'],
    // `head:changed` marks a guide stale. The pane reads the guide again on its own `changed`.
    events: ['head:changed', 'plugin:review-guide:changed'],
    // `tasks` reads the change request and the worktree, `git` diffs it, and `prefs` keeps the
    // harness the person picked. `identity` names the node's owner, whose pick the workflow step uses.
    // No network, no processes, and no secrets: the turn runs in the Agents plugin, and git runs
    // through core.
    node: {
      core: ['tasks', 'git', 'prefs', 'identity'],
      capabilities: ['agents.sessionExecute', 'agents.profiles'],
      secrets: false,
      exec: false,
      net: [],
    },
  },
  contributions: {
    frames: [{
      target: 'pane',
      id: 'guide',
      label: 'Guide',
      glyph: 'list-checks',
      layout: 'single',
      regions: { body: { kind: 'remote', entry: 'pane' } },
      // The pane links to the session the guide's turn runs in. A `managed-agent` target opens it in
      // the Agent pane.
      destinations: [{ id: 'session', label: 'Agent session', targetKind: 'managed-agent' }],
    }],
    // Per code host: the guide's narrow layout beside the change request's diff, which reads only the
    // `taskId` the host mounts it with, and the guide's notes as marks under the diff's rows.
    extensions: ['github', 'gitlab', 'bitbucket'].flatMap((host) => [
      { id: `${host}-review-panel`, point: `${host}:review-panel`, label: 'Guide', remote: 'panel' },
      { id: `${host}-diff-line`, point: `${host}:diff-line`, label: 'Guide notes', items: '/v1/p/review-guide/marks' },
    ]),
    commands: [{
      id: 'open',
      kind: 'action',
      title: 'Open review guide',
      category: 'pane',
      action: { verb: 'openPane', pane: 'guide' },
    }],
  },
}
