# Ticket 10: Version-1 cutover

Date: 2026-09-21. Status: implemented 2026-09-23; final release acceptance remains in ticket 13. Prerequisites: 02–09.
Read [context](./context.md), F11 in [findings](./findings.md), and the complete
[contract map](./reset-and-versioning.md#contract-identity-and-version-map).

## Outcome

Every Acorn-owned runtime, plugin artifact, public toolkit, and persisted-format entry point agrees on
the fresh version-1 baseline. Historical version-1 artifacts cannot be admitted accidentally.

## Work

- Introduce the immutable baseline constant and required admission markers exactly as specified in the
  reset policy. Keep discovery parsing tolerant, then reject missing/different baseline before pairing,
  plugin execution, root mutation, restore, or workflow admission.
- Change Node protocol to 1 and all owned routes/WS paths to `/v1`. Change service protocol to 1 and
  plugin API to string `1`. Update permission scopes, auth mounts, broker probes/reconnects, launchers,
  adapters, telemetry grouping, MCP/CLI requests, and fixtures as one coordinated change.
- Set Acorn workspace package release versions to `1.0.0`. Rebuild bundled manifests and update
  dependency/version fixtures without downgrading external dependencies or tooling formats.
- Make workflow format 1 required and add its baseline marker. Update authoring, parsing, generation,
  export/import, snapshots, and repository-owned examples. Reject user files with obsolete/missing
  identity; provide a diagnostic without rewriting their repositories.
- Change dashboard persisted format to 1. Isolate device/query-cache namespaces by baseline and
  include the marker in self-contained backups/exports. Keep already-1 Acorn contracts at 1.
- Remove `/v2` compatibility routes and any final old-format adapters. Preserve historical prose only
  when clearly labeled; operating instructions and plugin examples must describe the resulting contract.

## Acceptance

Fresh desktop, terminal, and standalone Node pair and reconnect; stale Nodes fail before use. Historical
API-1 manifests/workflows without the marker fail, even though their numeric version matches. Wrong
service version/baseline fails startup. New scaffolds build and install; bundled plugin trust and route
permissions still work. No old namespace cache hydrates. Current backups restore only to matching
baseline targets. Run `pnpm lint`, architecture/protocol/custody/toolkit tests, `pnpm db:check`, Node
boot integrations, and both host smoke paths. Ticket 13 owns the final whole-suite/release evidence.

## Verify before building

Search constants, route literals, generated artifacts, permission schemas, and package manifests.
Do not mechanically replace every `2` or `v2`: vendor protocols, tooling metadata, and historical records
are distinct. This ticket is one atomic contract change and must not be released halfway through.

## Implementation evidence

- `ACORN_BASELINE` owns the `acorn-1` marker. Node identity, probes and pairing, service startup,
  enrollment requests, installed plugin manifests, workflows, backups, and self-contained JSON
  exports carry it. Existing data roots and historical API-1 plugins or format-1 workflows without
  the marker are refused before adoption. Workflow files stay untouched and report a file error.
- Node HTTP and WebSocket routes use `/v1`; Node and service protocol majors are 1; plugin API is
  string `1`. Acorn package releases and bundled plugin manifests are `1.0.0`. The nine repository
  plugin bundles were rebuilt in an isolated directory and checked for baseline, API, and release.
  The plugin API snapshot, plugin and enrollment schemas, Cargo metadata, and pnpm lockfile were
  regenerated. Vendor and tool protocol versions were left with their owners.
- Workflow definitions use format 1 and the baseline in TOML and JSON authoring and import. Dashboard
  persistence uses format 1. Device preferences, tokens, fleet, plugin trust/cache, and query cache
  use baseline-specific names. The manual backup verifier reads the archive manifest and target
  identity before extraction; it rejects missing or different baselines.
- `pnpm lint` and `pnpm db:check` passed. Protocol: 175 tests; custody: 96; workflow: 475; focused
  Node workflow: 30; Node plugin load and Findings: 14; pairing and standalone parity: 16; service
  spawn: 3; Node manifest/installer/data-root: 204; backup: 6; toolkit suites: 30. Desktop package
  tests passed 102 renderer/boot tests and 38 Rust tests before the final custody-path change; the
  Rust suite then passed 39 tests. Terminal boot/cache passed 15 tests. Backup verifier passed 2.
- The real Tauri project session started the baseline-marked Node and rendered the workspace and
  local-node Home view; its automation session was stopped. The onboarding smoke reached a ready
  Node and loaded the bundled plugins, then failed in the existing development renderer path:
  Vite `/@fs/.../packages/client-core/src/kit/components/inputs/CopyButton.tsx` returned
  `Connection reset by peer (os error 54)` through the shell proxy, and the window reported
  `Importing a module script failed`. The architecture suite remains at 64/65 because the existing
  palette view invokes a host command. Both are recorded for ticket 13.

Ticket 13 resolved the palette edge and architecture passed 66/66. Its real Tauri automation uses
the staged renderer asset path by default; onboarding and project windows then loaded in the native
app scheme. The Vite dev proxy remains an opt-in debugging path with the cold `/@fs` import failure
recorded in ticket 13. This does not change the dated phase-10 result above.
