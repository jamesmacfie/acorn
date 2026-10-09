# Phase 04: browser contributions and GitHub handoff

Status: planned, October 10, 2026.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Page capture](./03-page-capture.md).

## Deliverable

Prove the public browser contribution contract with an in-page GitHub pull request button and a task
handoff.

## Starting point and owners

- `packages/protocol/src/plugin/contract.ts` and
  `packages/node-core/src/server/plugins/manifestValidation/node.ts` own declarations and route
  confinement.
- `packages/node-core/src/server/pluginHost/types.ts` and `plugins/github/src/node/index.ts` are the
  compiled contributor precedent.
- `plugins/github/src/client/contentLinks.ts` identifies repository/task relationships. Provider
  resolution belongs in the Node half.
- `packages/node-core/src/server/routes/projects/tasks.ts` owns task creation and connection-stamped
  links.

## Implementation steps

1. Add a bounded browser contribution descriptor for URL patterns, label, insertion anchor, and
   provider-owned resolution/context routes. Validate the descriptor using the shared URL grammar,
   own-plugin route rules, and contribution ID/size limits.

2. Advertise active loaded descriptors and equivalent compiled declarations. Use a core-owned
   generic discovery seam, with no provider names in core. Do not advertise an installed replacement
   before it becomes active.

3. Add native discovery and handoff operations that invoke only validated declared routes. Validate
   provider results before turning them into task seeds or draft context. Add a small loaded-plugin
   fixture to prove the contract is public.

4. Insert an extension-owned button in permitted GitHub pull request pages. Keep one control per
   contribution through client-side navigation and rerenders. Never interpolate page/plugin data
   into executable HTML, styles, or code.

5. Resolve the pull request in the GitHub Node plugin. Preserve repository, pull number, connection
   identity, title, and proposed context. Use authenticated provider operations rather than scraping
   the page.

6. Show already-linked tasks first and offer a picker if several match. Offer existing-task
   selection or linked task creation in the matching repository project. Keep a pull number out of
   an unrelated repository's task.

7. Open the selected task conversation. If none exists, retain the proposed context while the person
   starts a chat. Add context to the draft for review; a site button never sends it automatically.

8. Keep the same handoff action available in the sidebar when no DOM anchor is found. Clear controls
   when a contribution disappears, the node switches, or site access is removed.

## Demo and acceptance

Grant access on GitHub, click a pull request button, choose an existing task, and review its context
draft. On another pull request, create a linked task and start its conversation.

- Reject foreign routes, invalid patterns, duplicate IDs, oversized results, and inactive manifest
  declarations.
- Prove a loaded test plugin can declare a button and handoff without downloading browser code.
- Exercise duplicate prevention, client-side navigation, missing anchors, node switches, and
  permission removal.
- Verify case-insensitive repository identity, linked-task suggestions, repeated submission,
  unavailable credentials, and wrong-repository creation refusal.

## Verify and complete

Run manifest, plugin roster/discovery, task route, GitHub provider, and extension suites. Run lint
and architecture checks. Verify insertion and sidebar fallback on a real GitHub pull request.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop once GitHub and the public declaration fixture work. Do not implement a general Node action
runner, website automation, or remote plugin browser bundles.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.
