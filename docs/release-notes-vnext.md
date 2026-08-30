# Current release notes

The current acorn release is the Tauri desktop app plus the protocol-v2 Node runtime.

## Runtime

- The desktop loads the renderer from `app://acorn`.
- The desktop helper starts the built Node artifact as a supervised child under the bundled Node.
- Nodes serve HTTPS/TLS 1.3 on loopback with an ephemeral port and a pinned self-signed certificate.
- Renderer traffic and streams use the helper's connection broker, over one loopback WebSocket.
- Product routes are under `/v2/core/*` and `/v2/p/<plugin>/*`; live events and streams use
  `/v2/events`.

## Product

The release includes GitHub review, workspaces/tasks, the pane shell, terminal and managed agents,
notes/memory/context, workflows, Docker, PostgreSQL tools, encrypted HTTP requests, Linear, Rollbar,
model providers, Nodes, per-Node plugin toggles, Fleet surfaces, backup, configuration import, audit,
security settings, and the standalone Node tarball.

## Plugin UI

Every pane is one of eight host-owned layouts filled with regions, and the host draws the arrangement,
the divider and the drag handle. Every component a plugin may draw with is in one closed kit whose
props are role tokens rather than pixels, colours or classes. No plugin in this repository ships a
stylesheet or writes a raw `div`, and three tests hold that.

A loaded plugin draws the same components from a Web Worker with no DOM, so linear, rollbar, the API
pane and the Database pane are the shell's own nodes rather than an iframe. An iframe survives for
surfaces that own their pixels.

Plugins extend each other through five declared kinds of extension point: rows, annotations, remote
trees, rectangles and node-side hooks. The owner consents in its manifest, the host mints every name,
and the trust prompt names both sides. A compiled plugin and a sandboxed one fill the same point.

Keyboard navigation comes from the tree. `@opentui/keymap` turns a key into an intent before anything
sees it, the host owns selection and scroll state per collection, and the kit decides what is
focusable. Panes that had no arrow keys have them.

`npm create acorn-plugin` scaffolds a tree by default, and `--rectangle` scaffolds a frame.

## Security and operations

Authentication uses paired device tokens held by the desktop helper and scoped internal HMAC tokens for
Node-spawned children. GitHub uses OAuth device flow. Credentials are encrypted at rest and scrubbed
from backups. Preview views are isolated and remote preview tunnels require per-tunnel authentication.

The app reports disk-encryption status when available, retains a 90-day audit trail, and drains the
Node listener/plugins/databases on shutdown with a bounded deadline.

## Distribution status

The desktop DMG and standalone tarball build paths are implemented, and the DMG carries signed updater
artifacts. The build is ad-hoc signed and has no updater endpoint. Notarization and clean-machine
manual release verification remain release-operator tasks that require Apple signing credentials and
a fresh macOS environment.

For implementation contracts, use the parent topic docs and the source. The project-model migration
that produced this shape is finished. Its phase record is retired, so the reasoning lives in git
history.
