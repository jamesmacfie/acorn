# Phase 10: developer release acceptance

Status: planned, October 10, 2026.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

Every phase from [native pairing](./01-native-pairing.md) through [site
notifications](./09-site-notifications.md).

## Deliverable

Deliver reproducible Chrome and Firefox development builds with a CLI-installed independent bridge
and recorded end-to-end acceptance.

## Starting point and owners

- `apps/cli/vite.config.ts`, `apps/cli/bin/acorn.mjs`, and `scripts/pack-node.mjs` own standalone
  delivery.
- Read [local development](../../local-development.md), [testing](../../testing.md), and [writing
  docs](../../writing-docs.md).

## Implementation steps

1. Build the extension and CLI from a clean checkout using the supported Node runtime. Inspect
   emitted manifests, packaged scripts, native launcher paths, and stable development identities.

2. Verify host registration, status diagnostics, repair/reinstall after a moved or upgraded
   standalone installation, and uninstall. State how retained browser custody can be removed
   separately.

3. Test clean Chrome unpacked installation and Firefox temporary installation. Install from the
   built bundles and the CLI-registered host, not through `pnpm dev:extension`. The loop's own
   profile and development host would hide installation faults. Document that Firefox
   development loading is not signed persistent distribution. Do not promise browser store approval.

4. Run all release journeys against a local Node and a paired remote Node with the desktop closed.
   Confirm provider authentication remains on Node, and independently pair each browser.

5. Exercise browser restart, native-host restart, sleeping/unreachable Node, revoked pairing,
   changed certificate, and protocol mismatch. Reconcile durable state and preserve drafts; do not
   auto-retrust or replay writes.

6. Verify permissions from clean profiles, site-specific grants and removal, explicit temporary
   capture, incognito exclusion, and OS notification opt-in. Inspect sidebar screenshots at normal
   narrow and wider panel widths.

7. Add user setup/troubleshooting and plugin-author contribution instructions to the owning
   reference documentation. Mark completed phase status with evidence; keep unfinished acceptance
   visible.

## Demo and acceptance

A developer follows the setup instructions on macOS, pairs without the desktop, hands off one item
from each provider, captures an ordinary page, exchanges messages, resolves a request, and receives
a scoped badge.

- Run CLI, custody, protocol, extension, agents, GitHub, Linear, Rollbar, and touched Node-core
  suites plus any direct consumers.
- Run migration generation/checks if project persistence changed, lint, and repo architecture
  checks.
- Record real-browser results for install/uninstall, sidebar gestures, provider anchors, capture
  access, approval races, Node switches, restart recovery, and notification filtering.
- Record privacy checks for browser storage, OS messages, diagnostics, and site content-script
  responses.

## Verify and complete

Expect lint, affected suites, migration checks, and architecture checks to pass. Record browser
versions, installation form, local/remote Node setup, and any limitations alongside acceptance
evidence.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop at the documented developer release. Do not add public store submissions, signing
infrastructure, a separate installer, Windows/Linux support, screenshot editing, or new integration
families.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.
