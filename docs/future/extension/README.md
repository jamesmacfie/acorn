# Acorn browser extension

Status: proposed implementation programme, October 10, 2026.
Baseline: `f643f1f117261e1b67a21595ef787070731b1103`.

This document holds the decisions and architectural context for the browser extension.
The linked phases are handoffs for future developers. This documentation change implements no
extension runtime, native host, provider route, or database migration.

## Goal and release boundary

Let someone work with an Acorn agent while viewing a website. Success means they can bring a ticket,
pull request, error, selection, or screenshot into the right task and continue its conversation
without opening the desktop. They can also answer the agent's questions and permission requests.

The first release has these boundaries:

- Chrome and Firefox on macOS, installed as development builds.
- One shared extension in this monorepo, with small browser adapters.
- An independent native bridge installed through the standalone Acorn CLI. The desktop can remain
  closed; the selected local or remote node must already be running.
- Pairing in the sidebar, several remembered nodes, and one explicitly active node.
- GitHub pull requests, Linear issues, and Rollbar items as the first site integrations.
- URL, selected-text, and visible-tab screenshot capture into a reviewed agent message draft.
- Human and agent messages, attachment previews, simple tool summaries, questions, and approvals.
- Node-owned project/site associations and a site-scoped pending-request badge. OS notifications
  are opt-in.

These are product decisions from the planning conversation. Do not expand the release to implement
all ideas in the [integration survey](../integration-ideas.md).

## User journeys

### Hand off an external item

A permitted website shows an **Open in Acorn** button. Clicking it opens the sidebar and resolves
the
page through the contributing provider. Show an exact linked task first. Otherwise, suggest matching
projects and offer existing-task selection or creation of a linked task.

Resolve connection or project ambiguity with a picker. Do not silently choose the first credential,
create a duplicate task, or reuse whichever task the desktop happens to have focused. Show the node,
project, task, and session before sending anything to an agent.

If the task has no conversation, let the person choose an installed agent profile and start one.
Keep the item's proposed context in a draft during that step. Choosing an existing task does not
silently add a persistent external link; task creation includes the confirmed item link.

### Capture and continue a conversation

An explicit browser action can capture an ordinary page even without an installed site integration.
Capture the page link, selected text, or visible screenshot. Show a preview and allow removal before
send. Do not capture the full DOM, cookies, form contents, browsing history, or background tabs.

Keep unsent drafts keyed by node, task, and session in browser-local storage. Keep text and
screenshots
local until the person sends. Upload confirmed screenshot attachments through the agent API, then
submit an ordinary interactive turn. If sending fails after upload, retain the uploaded IDs with the
draft rather than uploading another copy automatically. Removing an uploaded draft attachment uses
the attachment deletion API.

The draft survives sidebar closure and reconnection. Switching nodes or sessions reveals that
selection's draft. It never moves the previous draft into the replacement conversation.

### Answer an agent

The sidebar reads the same durable conversation and pending requests as other clients. Show the
request title, details, choices, and permission scope. Use password inputs for secret answers.
Resolve through the managed agent API. A request another client already answered becomes resolved;
it does not gain another approval button or get replayed on reconnect.

## Owners and precedents

Read these before changing the corresponding boundary:

| Boundary | Source precedent | Implementation decision |
| --- | --- | --- |
| Browser client | `apps/desktop/vite.config.ts`, `pnpm-workspace.yaml` | Add `apps/extension`; share Solid, TypeScript, and Vite tooling without another application framework. |
| CLI delivery | `apps/cli/src/main.ts`, `apps/cli/bin/acorn.mjs`, `apps/cli/vite.config.ts` | Add host registration and a separate native execution path to the CLI. Keep native stdout free of CLI output. |
| Pairing and transport | `packages/custody/src/broker/nodePairing.ts`, `packages/custody/src/broker/nodeBroker.ts` | Reuse probe/pair, certificate pinning, status handling, and reconnect logic. |
| Credential storage | `packages/custody/src/local/public.ts`, `packages/custody/src/broker/fleetStore.ts` | Use separate native custody with the standalone CLI's file-permission convention. |
| Agent state and writes | `plugins/agents/src/server/routes/managed.ts`, `plugins/agents/src/contract/wire.ts` | Reuse sessions, snapshots, event pages, interactive turns, attachments, and request resolution. |
| Capture storage | `plugins/agents/src/client/composer/submitOperation.ts` | Reuse agent attachments and submitted input parts; do not add another capture database. |
| Loaded declarations | `packages/protocol/src/plugin/contract.ts`, `packages/node-core/src/server/plugins/manifestValidation/node.ts` | Add a bounded browser contribution kind with owner-confined provider routes. |
| Compiled contributors | `packages/node-core/src/server/pluginHost/types.ts`, `plugins/github/src/node/index.ts` | Supply the same contribution contract through a compiled-plugin declaration seam. Core remains provider-independent. |
| Task promotion | `packages/node-core/src/server/routes/projects/tasks.ts`, `packages/protocol/src/transport/api/projects.ts` | Reuse task seeds, connection-stamped links, and task creation behavior. |
| Project settings | `packages/node-core/src/server/projects/projectConfig.ts`, `packages/node-core/src/server/routes/projects/projects.ts` | Persist site associations with project configuration on Node. |
| Attention | `docs/notifications/rows-and-targets.md` | Derive pending-request presentation from authoritative agent state; do not add a second notification database. |

Also read [architecture](../../architecture-overview.md), [plugin map](../../plugin-map.md),
[scope ownership](../../state-ownership/scope-rules.md),
[attachments](../../managed-agents/attachments.md),
and [composer behavior](../../managed-agents/composer.md).

## Data flow and authority

The browser flow is website control → extension background → native bridge → pinned Node connection
→ provider or agent operation → sidebar. The website receives no Node credentials or conversation
state. Content scripts can report an explicit handoff intent; privileged extension pages own chat,
capture review, settings, and approvals.

The background owns one native connection. The native process owns credentials, certificate pins,
Node transport, and the active Node selection. Node owns projects, tasks, provider credentials,
agent
sessions, and durable events. Browser permission grants and delivery preferences belong to that
browser profile.

Use a versioned, typed native protocol with request IDs and explicit operations. Its first
operations
cover pairing, node selection, project/task reads, sessions, capture uploads, interactive messages,
request resolution, contribution discovery, and site resolution. Add operations alongside their
first caller. Do not build a generic route proxy, shell runner, subscription framework, or action
interpreter.

Bind every Node operation to its intended node, and task/session operations to their concrete IDs.
Reject a late request if its node no longer matches the active selection. Client responses carry the
same identity so a late read cannot replace another node's sidebar state.

Treat WebSocket events as invalidation hints. Coalesce refreshes and refetch durable snapshots or
paged events after reconnect and sequence gaps. Page conversation history and offer earlier-message
loading. Preserve operation idempotency keys across an explicitly retried submission. Do not
transparently retry mutations with uncertain outcomes.

Native messages have bounded sizes. Chunk responses and attachment bytes that exceed the browser
limit; bound transfer assembly and discard incomplete transfers after disconnect. Keep this a small
transport helper, without a general streaming or job system.

## Plugin contribution contract

Plugins declare URL patterns, button labels, CSS insertion anchors, and their own resolution/context
routes. The extension owns button markup, styling, insertion lifecycle, and supported actions.
The public v1 action types are handoff and capture into a user-reviewed draft.

Use the bounded content-link URL grammar for identifying external items, allowing the providers'
canonical trailing-slash forms. Browser host permissions use browser match patterns separately;
a project association or plugin declaration cannot grant browser access.

Discovery advertises active contributors only. Loaded-plugin descriptors come from the active
manifest, not an installed replacement waiting for activation. Compiled contributors expose the
same validated wire shape through their plugin-owned declaration. Validate route ownership, URL
patterns, descriptor limits, and duplicate IDs. Keep GitHub, Linear, and Rollbar names out of core.

Resolution returns provider-owned item identity, the resolving connection, a display title,
applicable project suggestions, an ordinary task promotion seed, and optional proposed context.
Multiple results remain multiple choices. Validate returned data before using it for task creation.
Do not trust page text as an external identifier or let a response redirect the native bridge to
another host.

Selectors and labels are data. Download no browser JavaScript, stylesheets, or executable plugin
expressions. Do not interpret arbitrary conditional action sequences as configuration.

## Project associations and browser access

Store explicit associations in Node-owned project settings as exact origins with optional path
prefixes. Include HTTP localhost origins for development. Default the path prefix to `/`. Settings
are machine-local project data, not committed `.acorn/config.toml` behavior in this release.

Use repository and external-project relationships as suggestions where the provider can establish
them reliably. Exact item links outrank project suggestions. Several matching projects require a
choice. On an unmatched site, present a project picker instead of selecting a global default.

Show matching projects by default, but allow an explicit switch. Remember that override locally for
the selected node and site. Keep a selected task/session bound across tab navigation; show a
mismatch
when the page's suggestions change instead of moving a draft. Notifications follow the active site's
matching or explicitly selected project scope, rather than the previously pinned conversation.

Request optional host access per site for persistent buttons. Manual capture uses a browser gesture
and temporary access. If the browser cannot capture from that gesture, ask the person to use the
extension toolbar action; do not widen host access silently. Remove injected controls and matching
notifications when access is revoked. Disable incognito access in v1.

Do matching in the browser from cached declarations and associations. Send the page URL to Node only
for an explicit handoff or capture. Do not transmit unrelated navigation for notification filtering.
If a site's layout changes, show its supported handoff in the sidebar even when no button anchor
can be found.

## Pairing and delivery defaults

Pair by entering the HTTPS Node address, probing identity, comparing the fingerprint out of band,
and entering the pairing code. Keep certificate material and tokens in native custody. A changed
certificate requires explicit pairing again. Do not auto-start Node or silently adopt desktop
tokens.

Follow the CLI's mode-0700 directory and mode-0600 token-file protection. Tokens are not encrypted
at
rest. Keep browser bridge custody separate from CLI and desktop custody. Use separate browser
custody
namespaces to avoid Chrome and Firefox hosts overwriting each other's fleet. Pair each browser
independently. Forgetting a node removes this client's custody; it does not revoke other clients.

The CLI installer registers an absolute runtime/launcher path in both browsers' user-level native
host directories. Check the invoking extension identity using the browser-specific argument form.
Use stable development extension identities and exact native-host allowlists. Provide status,
repair/reinstall, and uninstall instructions. Uninstall removes registrations and explains how to
remove retained pairings separately.

Chrome uses a Manifest V3 service worker and side panel. Firefox uses its supported background
script and sidebar implementation. Share the UI and domain logic, with small adapters for these API
differences. Firefox temporary installation is a developer-release limitation, not a claim that the
build is signed for everyday distribution.

Primary browser references are [Chrome native
messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
[Firefox native
messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging),
[background
compatibility](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background),
and [Chrome Manifest V3
requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).
Recheck them when implementation begins.

## Phases and dependencies

| Phase | Depends on | Demo |
| --- | --- | --- |
| [01: native pairing](./01-native-pairing.md) | None | Pair and list projects with the desktop closed. |
| [02: agent conversation](./02-agent-conversation.md) | 01 | Continue or start a task conversation. |
| [03: page capture](./03-page-capture.md) | 02 | Review and send page context and a screenshot. |
| [04: GitHub handoff](./04-github-handoff.md) | 03 | Open or create a task from a pull request. |
| [05: Linear handoff](./05-linear-handoff.md) | 04 | Resolve and hand off a connection-bound issue. |
| [06: Rollbar handoff](./06-rollbar-handoff.md) | 04 | Resolve a global item ID into its project counter. |
| [07: project site settings](./07-project-site-settings.md) | 04 | Edit associations and switch suggested projects. |
| [08: questions and approvals](./08-questions-and-approvals.md) | 02 | Answer a question and resolve a real permission request. |
| [09: site notifications](./09-site-notifications.md) | 07, 08 | Receive and clear a matching pending-request badge. |
| [10: developer release](./10-developer-release.md) | 01-09 | Install and complete the workflows in both browsers. |

Phases 05, 06, 07, and 08 can proceed independently after their stated prerequisites. The full first
release requires every phase. Each phase must remain buildable and demonstrate its own behavior.

## Verification and completion

Test behavior at boundaries: native framing and caller rejection, certificate changes and
revocation,
Node switches, reconnect recovery, stale replies, provider ambiguity, duplicate task suggestions,
attachment limits, wrong-session sends, duplicate buttons, permission revocation, and approval
races.
Use fixtures for provider failures and a small test plugin for the public contribution contract.

Run focused tests during each phase, then lint and full suites for changed packages and direct
consumers. Run architecture checks for descriptors, exports, migrations, and documentation. Use the
supported runtime from root `package.json`. If project settings require a schema change, generate
and
check that migration without changing unrelated plugin chains.

Finish with recorded real-browser acceptance on macOS against local and remote nodes, with the
desktop closed. Builds and mocked browser APIs alone do not prove native host registration, browser
permissions, sidebar gestures, or website selectors. Record limitations without marking those checks
as passed. Move verified behavior into its owning reference docs as phases ship.

## Deferred work and simplicity gate

Defer screenshot annotation, arbitrary-page task creation, custom Node actions, full desktop tool
renderers, simultaneous node aggregation, browser automation, browser-driven plugin installation,
public store submissions, a separate bridge installer, other operating systems, and a new capture
library or database.

The wider research included documentation capture, incident triage, cloud-console context, design
review, and workflow supervision. These remain uses for later contributions, not additional v1
requirements. The three providers prove code review, ticket work, and error investigation first.

Reuse custody, task promotion, provider identity, and agent contracts. Extract shared presentation
helpers only when the extension and another client both need them. Do not import the desktop host
runtime or create a general extension framework to accommodate hypothetical actions.
