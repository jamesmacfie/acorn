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
    // harness the person picked. No network, no processes, and no secrets: the turn runs in the
    // Agents plugin, and git runs through core.
    node: {
      core: ['tasks', 'git', 'prefs'],
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
    // The same tree as the pane, beside the diff in each code host's change request view. It reads
    // only the `taskId` the host mounts it with.
    extensions: ['github', 'gitlab', 'bitbucket'].map((host) => ({
      id: `${host}-review-panel`,
      point: `${host}:review-panel`,
      label: 'Guide',
      remote: 'pane',
    })),
    commands: [{
      id: 'open',
      kind: 'action',
      title: 'Open review guide',
      category: 'pane',
      action: { verb: 'openPane', pane: 'guide' },
    }],
  },
}
