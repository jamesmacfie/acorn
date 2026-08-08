# Current release notes

The current acorn release is the Electron desktop plus the protocol-v2 Node runtime.

## Runtime

- The desktop loads the renderer from `app://acorn`.
- Electron main starts the built Node artifact as a supervised Node child.
- Nodes serve HTTPS/TLS 1.3 on loopback with an ephemeral port and a pinned self-signed certificate.
- Renderer traffic and streams use the Electron main connection broker.
- Product routes are under `/v2/core/*` and `/v2/p/<plugin>/*`; live events and streams use
  `/v2/events`.

## Product

The release includes GitHub review, workspaces/tasks, the pane shell, terminal and managed agents,
notes/memory/context, workflows, Docker, PostgreSQL tools, encrypted HTTP requests, Linear, Rollbar,
model providers, Nodes, per-Node plugin toggles, Fleet surfaces, backup, configuration import, audit,
security settings, and the standalone Node tarball.

## Security and operations

Authentication uses paired device tokens held by Electron main and scoped internal HMAC tokens for
Node-spawned children. GitHub uses OAuth device flow. Credentials are encrypted at rest and scrubbed
from backups. Preview views are isolated and remote preview tunnels require per-tunnel authentication.

The app reports disk-encryption status when available, retains a 90-day audit trail, and drains the
Node listener/plugins/databases on shutdown with a bounded deadline.

## Distribution status

The desktop DMG/ZIP and standalone tarball build paths are implemented. Notarization and clean-machine
manual release verification remain release-operator tasks that require Apple signing credentials and
a fresh macOS environment.

For implementation contracts, use the parent topic docs and the source. The completed phase record is
kept under [docs/legacy/vNext](./legacy/vNext).
