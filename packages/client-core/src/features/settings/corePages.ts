import type { SettingsContribution } from '../../host/registries/shell/settings'

// Core's settings pages as declarations: where each sits, what it affects, and what search finds on
// it. Everything about a page except the component that draws it.
//
// Here rather than in a host, because two hosts list the same pages. The desktop draws each one
// (apps/desktop/src/client/pageContributions.tsx). The terminal lists all of them in the same groups
// and order, draws the few it has a form for, and says where to go for the rest
// (apps/tui/src/chrome/settingsPages.tsx). Two copies of this table would drift the first time a
// page moved group, and the terminal would list a page the desktop no longer has.

export type CoreSettingsPage = Omit<SettingsContribution, 'component'>

// What each page offers search, here rather than in the page, because a page is a lazy chunk and
// search must find it before it has ever loaded (docs/frontend.md § Search and deep links). A
// section's `id` is the `SettingsSection` the page draws and `rows` are its row labels, so a change to
// a page's sections is a change here too.
type SearchDeclaration = Pick<SettingsContribution, 'keywords' | 'sections'>

const appearance: SearchDeclaration = {
  keywords: ['dark mode', 'light mode', 'colour', 'color', 'density', 'typography', 'font'],
  sections: [
    { id: 'style', label: 'Style', rows: ['Style'] },
    { id: 'theme', label: 'Theme', rows: ["Match the system's light or dark mode", 'Theme', 'Light theme', 'Dark theme'] },
  ],
}
const notifications: SearchDeclaration = {
  keywords: ['sound', 'alert', 'badge', 'chime', 'dock', 'system notification'],
  sections: [
    { id: 'channels', label: 'How acorn tells you', rows: ['Play a sound', 'Show a system notification', 'Show a count on the app icon', 'Send a test'], keywords: ['test notification'] },
    { id: 'events', label: 'Notify me when', rows: ['An agent needs me', 'An agent finishes', 'An agent fails'] },
  ],
}
const shortcuts: SearchDeclaration = {
  keywords: ['keybindings', 'hotkeys', 'keys', 'chord', 'rebind', 'unbind'],
  sections: [
    { id: 'global', label: 'Global', rows: ['Open settings', 'Toggle rail', 'Switch to the last workspace', 'Show keyboard shortcuts'] },
    { id: 'panes', label: 'Panes', rows: ['Maximize or restore the focused pane', 'Toggle terminal drawer'] },
    { id: 'tasks', label: 'Tasks', rows: ['New task'] },
  ],
}
const cli: SearchDeclaration = {
  keywords: ['PATH', 'shell', 'install', 'headless'],
  sections: [
    { id: 'command', label: 'acorn command', rows: ['Location'] },
  ],
}
const workspaces: SearchDeclaration = {
  keywords: ['add folder', 'import', 'clone', 'new workspace', 'move project', 'hide project', 'rail colour', 'tab colour', 'color', 'select', 'bulk'],
  sections: [
    { id: 'projects', label: 'Projects' },
  ],
}
// Declared once and indexed once per workspace and once per project, under that one's name.
const workspaceDetail: SearchDeclaration = {
  keywords: ['rename workspace', 'delete workspace'],
  sections: [
    { id: 'general', label: 'General', rows: ['Name'], keywords: ['workspace name'] },
    { id: 'projects', label: 'Projects' },
    { id: 'connections', label: 'Connections', keywords: ['services it follows', 'linear', 'follow', 'project map'] },
    { id: 'danger', label: 'Danger zone', rows: ['Delete workspace'] },
  ],
}
const projectDetail: SearchDeclaration = {
  keywords: ['config.toml', 'rename project', 'change folder', 'build', 'worktree'],
  sections: [
    { id: 'general', label: 'General', rows: ['Name', 'Folder', 'Rail colour', 'Workspace', 'Hidden', 'Task branch prefix'], keywords: ['project name', 'tab colour'] },
    { id: 'danger', label: 'Danger zone', rows: ['Delete project'] },
    { id: 'worktree', label: 'Worktree', rows: ['Setup script', 'When to run it', 'Teardown script'], keywords: ['worktree setup script', 'worktree teardown script'] },
    { id: 'dev', label: 'Dev script', rows: ['Command', 'Restart command'], keywords: ['dev restart command', 'run button'] },
    { id: 'run-targets', label: 'Run targets', keywords: ['run button', 'default target'] },
    { id: 'preview-url', label: 'Browser preview', rows: ['Browser preview URL', 'Preview script', 'Preview URL', 'Preview port'] },
    { id: 'page-rules', label: 'Page rules', keywords: ['autofill login'] },
    { id: 'db-connection', label: 'Connection', rows: ['Connection URL command'], keywords: ['database', 'database url', 'postgres', 'DATABASE_URL'] },
    { id: 'schema', label: 'Query generation', rows: ['Schema source', 'Schema script', 'Schema file', 'Schema notes'], keywords: ['sql generation'] },
    { id: 'connections', label: 'Followed services', keywords: ['connections', 'services it follows', 'linear', 'follow', 'project map'] },
  ],
}
const agentTools: SearchDeclaration = {
  keywords: ['permissions', 'agent tools', 'mcp tools', 'allow', 'deny', 'execute', 'preview browser', 'owner', 'plugin tools'],
  sections: [
    { id: 'tiers', label: 'Tiers', rows: ['Read tools', 'Write tools', 'Execute tools'], keywords: ['acorn mcp server', 'claude mcp remove', 'codex mcp remove'] },
    { id: 'tools', label: 'Tools', keywords: ['by owner', 'by tier'] },
  ],
}
const mcp: SearchDeclaration = {
  keywords: ['.mcp.json', 'claude.json', 'cursor', 'servers', 'model context protocol'],
  sections: [
    { id: 'files', label: 'Config files', rows: ['Project', 'Starter file'] },
  ],
}
// A connection's own page is a detail of the list, drawn once per connection, so its sections are
// declared on the list page: search lands on the list, where the connection is one click away. A
// connection's name, indexed by the settings view, opens its page directly.
const services: SearchDeclaration = {
  keywords: ['integrations', 'connection', 'credential', 'token', 'replace key', 'rotate', 'disconnect', 'provider', 'linear', 'github', 'rollbar', 'sentry', 'sign in again'],
  sections: [
    { id: 'connections', label: 'Connections', keywords: ['add connection', 'rename', 'test', 'turn off', 'disable', 'disconnect', 'follow', 'project map', 'where it shows up', 'needs you'] },
  ],
}
const aiModels: SearchDeclaration = {
  keywords: ['model', 'api key', 'keys for generating text', 'default model', 'llm', 'anthropic', 'openai', 'claude', 'codex', 'commit message', 'sql generation', 'generate'],
  sections: [
    { id: 'generate', label: 'Generating text', rows: ['Generate with'], keywords: ['default model', 'this device'] },
    { id: 'keys', label: 'API keys', keywords: ['add a key', 'provider key', 'replace key'] },
    { id: 'clis', label: 'Agent CLIs', keywords: ['installed', 'not installed', 'path'] },
  ],
}
const schedules: SearchDeclaration = {
  keywords: ['cron', 'timer', 'recurring', 'periodic', 'unattended', 'kill switch', 'run now', 'cadence', 'every hour', 'every day', 'weekly'],
  sections: [
    { id: 'schedules', label: 'Schedules', rows: ['Pause every schedule on this node'], keywords: ['pause', 'resume', 'run now', 'delete', 'next run', 'last run', 'backed off', 'tier'] },
    { id: 'new', label: 'New schedule', rows: ['Action', 'Name', 'When'], keywords: ['create', 'add', 'accept', 'risk'] },
  ],
}
const runs: SearchDeclaration = {
  keywords: ['workflow runs', 'agent sessions', 'cost', 'spend', 'history'],
  sections: [
    { id: 'runs', label: 'Recent runs' },
  ],
}
const nodes: SearchDeclaration = {
  keywords: ['pair', 'pairing code', 'fingerprint', 'unpair', 'revoke', 'reconnect', 'rename', 'device', 'control plane', 'remote', 'fleet'],
  sections: [
    // Adding a node is the Paired nodes section's action, and its form opens there.
    { id: 'paired', label: 'Paired nodes', rows: ['Node address', 'Pairing code', 'Name for this computer', 'Name for this node'], keywords: ['add a node', 'pair', 'fingerprint', 'unpair', 'revoke', 'reconnect', 'rename', 'detach'] },
    { id: 'provided', label: 'Nodes from a provider', rows: ['Name for the new node'], keywords: ['cloud', 'adopt', 'destroy', 'start', 'stop'] },
  ],
}
const security: SearchDeclaration = {
  keywords: ['encryption', 'FileVault', 'backup', 'archive', 'restore'],
  sections: [
    { id: 'encryption', label: 'Disk encryption', rows: ['Full-disk encryption'] },
    { id: 'backup', label: 'Backup', rows: ['Save to'], keywords: ['archive path'] },
  ],
}
const audit: SearchDeclaration = {
  keywords: ['history', 'security log', 'pairing', 'revoked', 'credentials'],
  sections: [
    { id: 'trail', label: 'Recent activity', keywords: ['audit trail'] },
  ],
}
const telemetry: SearchDeclaration = {
  keywords: ['analytics', 'tracking', 'privacy', 'logs', 'errors', 'sinks'],
  sections: [
    { id: 'collection', label: 'Collection', rows: ['Collect timings, logs, and errors on this node'], keywords: ['where it goes'] },
    { id: 'collected', label: 'What this node has collected', keywords: ['what a record can hold'] },
  ],
}
// The agents plugin's section (`agents`) is drawn through CORE_STORAGE_POINT and declared here, because
// search reads declarations and a point's contributions are not known until the page draws them.
const storage: SearchDeclaration = {
  keywords: ['memory', 'disk', 'cache', 'database', 'agents', 'processes', 'idle', 'size', 'ram', 'free space'],
  sections: [
    { id: 'agents', label: 'Agents', rows: ['Running agents', 'Idle', 'Memory', 'Attachments', 'Artifacts'], keywords: ['stop idle agents now'] },
    { id: 'process', label: 'Node process', rows: ['Memory'] },
    { id: 'disk', label: 'Disk', rows: ['Core database', 'Blob cache'], keywords: ['sqlite', 'write-ahead log'] },
    { id: 'cache', label: 'Saved cache on this device', rows: ['Size', 'Entries'], keywords: ['clear cache', "clear this node's copy"] },
  ],
}
const plugins: SearchDeclaration = {
  keywords: ['install', 'uninstall', 'extension', 'npm', 'github', 'tarball', 'local folder', 'dev mode', 'trust', 'bundle', 'restart node', 'approve', 'needs you'],
  sections: [
    { id: 'installed', label: 'Installed plugins', rows: ['Install…'], keywords: ['keep its data', 'delete its data', 'staged package', 'revoke approval', 'end dev mode', 'this device'] },
    { id: 'create', label: 'Create a plugin', rows: ['Ask an agent to write one'] },
  ],
}
const railSurfaces: SearchDeclaration = {
  keywords: ['rail icon', 'hide', 'show in left rail', 'sidebar'],
  sections: [
    { id: 'rail', label: 'Left rail', keywords: ['source', 'icon', 'hidden'] },
    { id: 'surfaces', label: 'Replaced surfaces', rows: ['Task list in the rail', 'Pane switcher', 'Left rail', 'Top bar'], keywords: ['exclusive slot', 'replace'] },
  ],
}
const deviceConfig: SearchDeclaration = {
  keywords: ['acorn.json', 'config file', 'edit by hand'],
  sections: [
    { id: 'file', label: 'Location', rows: ['File'] },
  ],
}
const clearCache: SearchDeclaration = {
  keywords: ['reload', 'reset', 'stale', 'refresh'],
  sections: [
    { id: 'cache', label: 'This window', rows: ['Saved copies of what acorn loaded'] },
  ],
}
const extensionPoints: SearchDeclaration = {
  keywords: ['slots', 'contributions', 'unmatched', 'plugin author', 'debug'],
  sections: [
    { id: 'points', label: 'Available points', rows: ['Which plugin draws this'] },
    { id: 'unmatched', label: 'Contributions that match nothing' },
  ],
}

// Core's settings pages, placed in the rail's nine groups (docs/frontend.md § Settings). Ids are
// stable because callers deep-link by them: `openSettings('shortcuts')`, a notice target's page id,
// the palette's rows. `order` counts within a group.
//
// The seven pages that name their node through `context.scope.nodeId` declare `followsNodeSwitcher`, so
// the header's switcher is theirs. Every other node page reads the active node through the ambient API
// client, and its header says so.
export const CORE_SETTINGS_PAGES = [
  // General: this screen, not the node. Each is a device preference, like the theme.
  { id: 'appearance', ...appearance, label: 'Appearance', category: 'general', scope: 'device', icon: 'palette', order: 10 },
  { id: 'notifications', ...notifications, label: 'Notifications', category: 'general', scope: 'device', icon: 'bell', order: 20 },
  { id: 'shortcuts', ...shortcuts, label: 'Keyboard shortcuts', category: 'general', scope: 'device', icon: 'keyboard', order: 30 },
  { id: 'cli', ...cli, label: 'Command line', category: 'general', scope: 'device', icon: 'square-terminal', order: 40 },

  // Workspaces and projects. Overview is the node's whole map; the workspace page and the project page
  // are each drawn once per workspace or project, under its own rail row, at
  // `settings/workspace/<id>` and `settings/project/<id>`.
  { id: 'workspaces', ...workspaces, label: 'Overview', category: 'workspaces', scope: 'node', icon: 'layout-grid', order: 10 },
  { id: 'workspace.detail', ...workspaceDetail, label: 'Workspace', category: 'workspaces', scope: 'workspace', icon: 'folder', order: 20 },
  { id: 'project.detail', ...projectDetail, label: 'Project', category: 'workspaces', scope: 'project', icon: 'folder', order: 30 },

  // Agents. The agents plugin files its own pages here too; these two are core's. Tools and
  // permissions, because the tool registry it edits is projected from every plugin's contributions,
  // so no single plugin owns the page.
  { id: 'agent-tools', ...agentTools, label: 'Tools and permissions', category: 'agents', scope: 'node', icon: 'wrench', order: 30 },
  { id: 'mcp', ...mcp, label: 'MCP config files', category: 'agents', scope: 'node', icon: 'file-code', order: 50 },

  // Connections. Services keeps the id `integrations`, which plugins and notices deep-link to. A model
  // key is a connection too, but it is listed on AI models, beside the agent CLIs it competes with.
  { id: 'integrations', ...services, label: 'Services', category: 'connections', scope: 'node', icon: 'plug', order: 10 },
  { id: 'ai-models', ...aiModels, label: 'AI models', category: 'connections', scope: 'node', icon: 'sparkles', order: 20 },

  // Automation. A schedule is a promise one machine makes (docs/schedules.md), and a run happens on one
  // machine. Run history is core's rather than any plugin's, because the list is merged from every
  // plugin that declared a run source and no one of them owns it (@acorn/protocol/runs.ts).
  { id: 'schedules', ...schedules, label: 'Schedules', category: 'automation', scope: 'node', icon: 'calendar-clock', order: 10, followsNodeSwitcher: true },
  { id: 'runs', ...runs, label: 'Run history', category: 'automation', scope: 'node', icon: 'clock', order: 20, followsNodeSwitcher: true },

  // Machines. Nodes is the device's fleet, so its scope is this device. Not `requires: 'desktop'`: the
  // page renders its own explanation in a browser, where there is no broker and so no fleet.
  { id: 'nodes', ...nodes, label: 'Nodes', category: 'machines', scope: 'device', icon: 'server', order: 10 },
  // security.md § On-disk asks the app to surface the disk-encryption posture, and § Audit says the
  // trail is "owner-readable in Settings". Two pages, because they answer two questions.
  { id: 'security', ...security, label: 'Security and backup', category: 'machines', scope: 'node', icon: 'shield', order: 20, followsNodeSwitcher: true },
  { id: 'audit', ...audit, label: 'Audit log', category: 'machines', scope: 'node', icon: 'scroll-text', order: 30, followsNodeSwitcher: true },
  // `telemetry.enabled` is a preference on the node rather than on this screen (docs/telemetry.md).
  { id: 'telemetry', ...telemetry, label: 'Telemetry', category: 'machines', scope: 'node', icon: 'activity', order: 40, followsNodeSwitcher: true },
  // Memory and disk are facts about one machine. Core's page, with a section each plugin that holds
  // either contributes through CORE_STORAGE_POINT (docs/data-layer.md § What the node reports).
  { id: 'storage', ...storage, label: 'Storage and memory', category: 'machines', scope: 'node', icon: 'hard-drive', order: 50, followsNodeSwitcher: true },

  // Plugins. Not `requires: 'desktop'`, for the same reason as Nodes. The node's plugins follow the
  // switcher; the device's, listed beside them, are this device's whatever the header says.
  { id: 'plugins', ...plugins, label: 'Installed', category: 'plugins', scope: 'node', icon: 'puzzle', order: 10, followsNodeSwitcher: true },
  // What plugins put in this device's chrome: every rail source's icon, and the core surfaces a plugin
  // may draw instead, which used to sit at the foot of the plugin list.
  { id: 'rail-surfaces', ...railSurfaces, label: 'Rail and surfaces', category: 'plugins', scope: 'device', icon: 'panel-left', order: 20 },

  // Advanced: this device's own tools. The desktop adds a style gallery in dev builds. It is a tool for
  // writing style packs, so it stays the desktop's and is not in this table.
  { id: 'device-config', ...deviceConfig, label: 'Device config file', category: 'advanced', scope: 'device', icon: 'file-cog', order: 10 },
  // The top bar menu's Clear cache, as a page someone can find by looking in settings.
  { id: 'clear-cache', ...clearCache, label: 'Clear cache', category: 'advanced', scope: 'device', icon: 'trash-2', order: 20 },
  { id: 'extension-points', ...extensionPoints, label: 'Extension points', category: 'advanced', scope: 'device', icon: 'blocks', order: 30 },
] as const satisfies readonly CoreSettingsPage[]

export type CoreSettingsPageId = (typeof CORE_SETTINGS_PAGES)[number]['id']
