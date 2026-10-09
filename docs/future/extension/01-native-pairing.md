# Phase 01: native pairing

Status: planned, October 10, 2026.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

None. This is the first runnable slice.

## Deliverable

Install a development extension and its native bridge, pair a Node from the sidebar, and list that
Node's projects with the desktop closed.

## Starting point and owners

- `apps/cli/src/main.ts`, `apps/cli/bin/acorn.mjs`, and `apps/cli/vite.config.ts` own CLI dispatch
  and delivery.
- `packages/custody/src/broker/nodePairing.ts`, `packages/custody/src/broker/nodeBroker.ts`, and
  `packages/custody/src/broker/fleetStore.ts` own pairing, transport, and fleet storage.
- `packages/protocol/src/transport/broker.ts` defines Node identity and fetch contracts.

## Implementation steps

1. Add the `@acorn/extension` workspace under `apps/extension`. Use shared Solid/Vite sidebar code
   with separate Chrome and Firefox manifests and small API adapters. Build extension pages and
   packaged background/content scripts without remote execution code.

2. Add CLI install, status, and uninstall commands for the native host. Register stable development
   extension identities and exact allowlists. Resolve absolute launcher and Node-runtime paths
   during installation; do not depend on the browser's shell PATH.

3. Create a native-host entry that reads length-prefixed messages and emits framed replies only.
   Send diagnostics to stderr. Validate Chrome and Firefox invocation arguments independently. Bound
   input, response, and transfer assembly sizes; chunk large replies below the native message limit.

4. Add the minimal typed native operations for node listing, probe, pair, select, forget, and
   project listing. Keep the native process as a thin adapter over custody. Add later operations
   only with their consuming phase.

5. Build sidebar pairing with address entry, compatible/incompatible status, fingerprint comparison
   confirmation, and code entry. Reuse probe and pinned pair helpers; never return a token or
   certificate private material to the extension.

6. Remember nodes in separate browser bridge custody. Connect only the active selection through
   NodeBroker. Bind requests and replies to that node. Preserve device selection in browser storage
   and restore it when the native connection restarts.

7. Show missing-host, invalid-code, offline, revoked, identity-change, and incompatible-node states
   with an actionable next step. Keep pairing and forgetting usable when restoring a stale selection
   fails.

## Demo and acceptance

Build both development bundles. Register the host through the CLI. Pair a local Node, list projects,
pair a remote Node, switch to it, and restart the browser. Repeat with the desktop closed.

- Reject an unregistered extension identity, malformed frames, oversized length headers, and
  incomplete transfers.
- Exercise fingerprint confirmation, bad code, changed certificate, revoked device, and incompatible
  protocol against controlled TLS fixtures.
- Switch nodes while a read is outstanding. Confirm the late response cannot replace the selected
  node's projects.
- Inspect registrations and custody file modes. Confirm no token appears in browser storage,
  messages, or diagnostics.

## Verify and complete

Run custody and CLI suites, the extension suite, lint, and architecture checks. Inspect the built
manifests and run real native messaging in both browsers.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop once pairing, selection, and project reads work in both browsers. Do not start Node, reuse
desktop credentials, add chat APIs, or implement a separate release installer in this phase.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.
