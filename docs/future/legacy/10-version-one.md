# Ticket 10: Version-1 cutover

Date: 2026-09-21. Status: not started. Prerequisites: 02–09.
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
