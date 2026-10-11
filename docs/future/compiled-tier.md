# Compiled plugin migration candidates

Date: October 8, 2026. Status: standing migration assessment; no migration scheduled.

Read this page before proposing a compiled plugin move. [First-party plugins](../first-party-plugins.md)
owns the privilege inventory, and [extensibility](../extensibility.md) owns the permanent tier boundary.
A move needs a concrete benefit, such as independent releases or a caller that needs a loaded package.

## Starting point

The loaded source packages are agent-cost, database, http, linear, model-providers, nodes-file,
rollbar, and sentry-telemetry. nodes-file is not bundled. The other compiled registrations are in
`apps/node/src/composition/plugins.ts` and `apps/desktop/src/client/plugins.ts`.

Remote component trees and cooperative extension points are implemented. Changes' transcript card
uses `agents:tool-card`, so an in-realm renderer does not block its migration.
The host owns CodeMirror; editor bundle size is not its migration blocker.

Use the owning inventory rather than the removed August census. In particular, memory and notes
provide required capabilities, Docker owns streams, and Editor owns both a PTY channel and persisted
multi-document state.

## Assess a candidate

| Candidate | Work to assess before a move |
| --- | --- |
| Changes | No structural blocker is recorded. Convert route carriers and test a loaded package if independent delivery is wanted. It stays compiled by product preference. |
| GitHub | Trace `GITHUB_MIRROR` consumers and core project repository fields. Design any authority or addressing change before moving the provider. |
| Workflows | Trace `WORKFLOWS_RUNNER`, `WORKFLOW_ROUTE`, client `WORKFLOW_CONTROL`, constructor adapters, and extension-point ownership. Define route or capability contracts for actual consumers. |
| Context | Its persisted state and synchronous context revision need an explicit replacement or a decision to keep that owner compiled. |
| Editor | Its `$EDITOR` PTY channel, open-file persistence, and multiple documents exceed the loaded document layout. An open-file command alone does not complete the move. |

Agents, terminal, preview, memory, notes, onboarding, browser, and Docker have first-party obligations
listed in [the inventory](../first-party-plugins.md). Reassess them only with a demonstrated requirement
and a design for every obligation. Moving a tree into a worker does not replace transport ownership,
required capabilities, native dependencies, or constructor adapters.

## Implement an approved move

Follow these steps for one plugin at a time:

1. List production imports, constructor dependencies, capabilities, routes, state, streams, and
   host-only registrations. Name the consumer of each one.
2. Use published loaded-plugin contracts for asynchronous data and host components for UI.
   Keep secrets, storage authority, and required host services with their owners.
3. Preserve plugin identity, database migrations, stored state, consent, and contribution availability.
   Define any migration before writing it.
4. Build and install the package through the real loaded-plugin path. Remove compiled registrations
   and imports only after its contributions work through that path.
5. Remove obsolete private registries and reduce architecture baselines to the observed graph.
   Keep testkit dependencies explicit; do not raise a ceiling to hide a leftover import.

Acceptance: fresh install, upgrade with saved data, disablement where permitted, failure, reload,
Node switching, and both supported hosts behave as documented. A required capability remains
available throughout startup and reconciliation.

## Verify retained cleanup candidates

These reports need a reproduction before a fix. They are independent of a plugin migration:

- `topbar.left` and `task.switcher.extra` remain in
  `packages/client-core/src/host/registries/extensionPoints/slots.ts`. Search callers and compatibility
  handling before removing either type member.
- The broker can throw `Unknown node` when an address has no connection. Confirm the caller's
  connection state and provide a recoverable error if it escapes that model.
- Earlier reports described a local Node label resetting after identity changes and stale GitHub
  mirror rows without a visible partial-refresh signal. Reproduce each with a disposable Node.
- `onSelectTarget` remains optional in reference-panel props. Confirm consumers before removing it.

For each confirmed issue, test the observable failure and update its owning reference page.

## Complete loaded-package acceptance

The migration record left live acceptance open for provider surfaces and installer-driven updates.
Use [desktop and plugin checks](../testing/desktop-and-plugins.md) and the relevant feature checks.
Record real-token provider reads, update consent, contribution replacement, and state retention.
For database, verify the composed editor, execution, completions, retained scratch text, and bounded
result rendering against disposable data. Verify Linear reference panels and HTTP writes separately.

The overlay carrier has manifest, host, and companion-overlay implementations. Confirm whether a
loaded package exercises the complete flow before retaining the earlier first-consumer gap.

## Scope boundaries

Bare references without a confirming URL need a separate bounded host parser and provider
confirmation design. Require a live provider connection and confirmation through its `refResolvers`
route. Define how competing providers resolve the same token before implementation.
Plugin-supplied regular expressions remain excluded.
Loaded routes remain confined under the plugin's prefix. Cleaner URLs do not justify removing that
boundary. These decisions are independent of moving a compiled package.

## Verify before building

- Read the composition lists and first-party inventory; repeat the dependency assessment for the candidate.
- Inspect loaded context types, storage, contribution descriptors, and compatibility rules.
- Reproduce retained issues and check dated acceptance records before assigning a fix.
- Run lint, owner and consumer suites, architecture checks, and installed-package acceptance.
