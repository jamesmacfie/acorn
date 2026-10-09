# Phase 09: site notifications

Status: planned, October 10, 2026.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Project site settings](./07-project-site-settings.md) and [questions and
approvals](./08-questions-and-approvals.md).

## Deliverable

Notify the person about pending agent questions and approvals for the active site/project while the
sidebar is closed.

## Starting point and owners

- `packages/custody/src/broker/nodeBroker.ts` supplies transport status and event hints.
- `plugins/agents/src/server/routes/managed.ts` and `plugins/agents/src/contract/wire.ts` supply
  authoritative session/request reads.
- Read [notification rows and targets](../../notifications/rows-and-targets.md) before adding any
  attention contract.

## Implementation steps

1. Maintain the native connection from the browser background context while the browser runs.
   Restore selection and refetch durable state after background/native process restart. Use
   browser-supported lifetime behavior, not a timer to evade worker suspension.

2. Derive pending requests for the active site's matching or explicitly selected project scope on
   the active node. Follow the context document's distinction between page notification scope and a
   conversation pinned during navigation.

3. Use existing scoped session/attention reads and refresh hints. If a bounded aggregate request
   read is missing, add it to the agents owner rather than scanning every transcript repeatedly or
   building a second notification store.

4. Show a browser badge for pending questions/approvals. Clicking the toolbar opens the sidebar's
   scoped request list, and choosing a request opens its concrete task/session.

5. Offer opt-in OS notifications after browser permission is granted. Use generic text and a scoped
   destination, with local deduplication of delivered request IDs. Do not put prompts, answers,
   URLs, or approval payloads into OS messages.

6. Clear resolved/expired requests from the badge and deduplication state. Handle reconnect, site
   changes, project overrides, mute/permission revocation, and inactive nodes without stale counts
   or cross-project leakage.

7. Keep local notification preferences independent of Node associations. If access is absent, show
   no background site-specific request delivery until the user explicitly selects a scope in the
   sidebar.

## Demo and acceptance

Close the sidebar on a mapped site, trigger a request for its project, and see the badge. Resolve
from another client and watch it clear. Trigger a different project's request and verify it does not
appear.

- Exercise same-domain path scoping, project overrides, a pinned conversation on another site, and
  one active node.
- Restart the native process/background worker; reconcile pending requests and avoid duplicate OS
  notifications.
- Resolve, expire, or revoke access while a badge is visible; clear it from authoritative state.
- Confirm notification text contains no request content or secrets, and that its click selects the
  correct session.

## Verify and complete

Run attention/request and extension background tests, affected suites, and lint. Verify
sidebar-closed delivery, restart recovery, and OS opt-in in both browsers.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop at questions/approvals, badges, and opt-in OS delivery. Do not aggregate inactive nodes or add
a general workflow notification engine.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.
