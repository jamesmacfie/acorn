# The terminal plugin

The terminal plugin runs the desktop terminal drawer, task terminal sessions, run targets, provider
profiles, and the handoff from a managed agent to its raw CLI. Read this page to find the topic page
for a part of it. The plugin is in `plugins/terminal/`.

Three docs have "terminal" in the name:

- This one covers the terminal drawer: a shell, or a provider's own CLI, running raw in a PTY.
- [Managed agents](./managed-agents.md) covers the other way to run the same providers, where acorn
  drives the session over a protocol and keeps a ledger of every turn.
- [Terminal client](./tui.md) covers acorn itself running in a terminal, as a second host beside the
  desktop window.

Worktree creation is a core-owned choke point. When core creates a worktree, it resolves the
`core.taskWorktreeCreated` capability the terminal plugin supplies, and the plugin runs the setup
script. The capability belongs to one Node runtime and is disposed with the terminal engine.

## Pages

<a id="sessions"></a>
<a id="the-screen-and-who-pays-for-it"></a>
<a id="task-script-evidence"></a>

- [Terminal sessions](./terminal/sessions.md) covers storage, attach and restore, the screen and
  ring, binary output frames, session lifecycle, and task script evidence.

<a id="activity-and-status"></a>
<a id="backpressure"></a>
<a id="sending-text-to-an-agent"></a>

- [Activity and delivery](./terminal/activity.md) covers idle and blocked detection, the frames those
  edges send, backpressure, and `sendToAgent`.

<a id="process-broker"></a>
<a id="workflow-steps"></a>
<a id="from-the-command-palette"></a>

- [Run targets](./terminal/run-targets.md) covers the process broker, run target trust and
  serialization, the two workflow step kinds, and the palette rows.

<a id="client"></a>
<a id="native-terminal-client-sessions"></a>

- [The terminal drawer](./terminal/client.md) covers the drawer, held terminals, the `pty` rectangle,
  and terminal client sessions.

## Profiles

The agents plugin registers the Claude Code, Codex, and Aider profiles in
`plugins/agents/src/node/index.ts`, from `plugins/agents/src/server/profiles/`. Claude Code and Codex
support interactive and headless modes. Aider is interactive only. Argument grammars stop callers from
appending flags, and core creates and deletes Codex output schemas on every execution path.

Profiles are separate from managed-agent drivers. A raw terminal works without a managed session, and
a managed session can use a driver without a terminal tab.

The Node lists profiles by running `which` for tmux and each agent CLI, which blocks its event loop
for about 20 ms. So the drawer reads the list through the query cache with a five-minute stale time
(`PROFILES_STALE_MS`), and a newly installed CLI appears within five minutes or on reload.
`resolveBackend` falls back from a profile's `tmux` preference to `node-pty` when tmux isn't
installed.

## Handoff

The agents plugin owns the managed session. The terminal plugin publishes a narrow session roster
and handoff capability. Handoff moves an exclusive input lease to the raw TUI, and the managed
composer is disabled while the TUI owns input. Returning to managed mode needs the linked terminal
process to exit first. The Node then restores the managed session from its resumable reference.
