# Release notes

This page lists what the current build contains and what changed for people who run it or write
plugins for it. The package version is 1.0.0, and no release has been tagged. The Node probe and
pairing response report the `acorn-1` baseline.

## Memory library and import

Added on October 2, 2026. The Memory page lists, searches, edits, deletes, and restores memories, and
shows each memory's history. It can preview and import a folder of Claude memory files, with a choice
to skip or overwrite each collision. [Notes and memory](./notes-and-memory.md) covers it.

## Memory phase 2

Added on October 2, 2026. Plugin API major 3 removes `terminal.reviewInput.v1` and
`workflows.reviewInput.v1`. Rebuild installed plugins with a manifest range that covers major 3.

Memory reads and searches Markdown files in the private root and the selected project's folder.
The Findings plugin, review settings, review notices, archive capture, and the derived search
database are retired. Agent writes, standing context, transcript cards, and Undo use the file store.
acorn doesn't read a repository's `.acorn/memory` folder.

acorn leaves `plugins/findings.sqlite` and `plugins/memory.sqlite` on disk and doesn't open them. You
can delete them by hand after you keep any review records you want.

## The acorn-1 baseline

The baseline includes the Tauri desktop app, the terminal client, a headless CLI, and a standalone
Node.

### Runtime

- The desktop loads the renderer from `app://acorn`.
- The desktop helper starts the built Node artifact as a supervised child under the bundled Node.
- Nodes serve HTTPS with TLS 1.3 on loopback, on an ephemeral port, with a pinned self-signed
  certificate.
- Renderer traffic and streams go through the helper's connection broker, over one loopback
  WebSocket.
- Product routes are under `/v1/core/*` and `/v1/p/<plugin>/*`. Live events and streams use
  `/v1/events`. The Node probe and pairing response carry `baseline: "acorn-1"`.
- `acorn node start --background` owns a persistent local service with an authenticated startup
  handshake. `status` and `stop` act only on that service.

### Product

The baseline includes GitHub review, workspaces and tasks, archived task search and restore, the
pane shell, terminals and managed agents, notes, memory, context, workflows, Docker, PostgreSQL tools,
encrypted HTTP requests, Linear, Rollbar, model providers, Nodes, per-Node plugin toggles, Fleet
views, backup, configuration import, audit, security settings, and the standalone Node tarball.

Managed agents can delegate to a child session and report back to their owner. Workflows can be
written in the app or loaded from repository TOML. Headless `acorn` commands use the same paired Node
to manage workspaces, projects, tasks, agents, workflows, and runs. Loaded plugins can expose typed
commands, and the Database plugin offers a bounded read-only `query`. [CLI](./cli.md) covers the
command contract.

### Plugin UI

Every pane is one of eight host-owned layouts filled with regions. The host draws the arrangement,
the divider, and the drag handle. Every component a plugin may draw is in one closed kit, whose props
are role tokens instead of pixels, colors, or classes. No plugin in this repository ships a
stylesheet or writes a raw `div`, and three tests hold that.

A loaded plugin draws the same components from a Web Worker with no DOM, so the Linear, Rollbar, API,
and Database panes are the shell's own nodes, not iframes. An iframe remains for surfaces that own
their pixels.

Plugins extend each other through five kinds of extension point: rows, annotations, remote trees,
rectangles, and Node-side hooks. The owner consents in its manifest, the host mints every name, and
the trust prompt names both sides. A compiled plugin and a sandboxed one fill the same point.

Keyboard navigation comes from the tree. `@opentui/keymap` turns a key into an intent before anything
else sees it. The host owns selection and scroll state per collection, and the kit decides what's
focusable.

`npm create acorn-plugin` scaffolds a tree by default, and `--rectangle` scaffolds a frame.

### Security and operations

Authentication uses paired device tokens held by the desktop helper, and scoped internal HMAC tokens
for children the Node spawns. GitHub uses OAuth device flow. Credentials are encrypted at rest and
removed from backups. Preview views are isolated, and remote preview tunnels need per-tunnel
authentication.

The app reports disk-encryption status where it can, keeps a 90-day audit trail, and drains the Node
listener, plugins, and databases on shutdown within a bounded deadline.

### Distribution

The macOS DMG, the Windows installer, and the standalone tarball build. The desktop build is ad-hoc
signed and carries signed updater artifacts, but no updater is compiled in and no update endpoint is
set. Notarization and a manual check on a clean machine are release-operator tasks. They need Apple
signing credentials and a fresh macOS environment.
