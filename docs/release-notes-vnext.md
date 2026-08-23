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
