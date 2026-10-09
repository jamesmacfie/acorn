# Phase 08: questions and approvals

Status: planned, October 10, 2026.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Agent conversation](./02-agent-conversation.md). Can proceed independently of phases 03-07.

## Deliverable

Answer agent questions and resolve permission requests from the same task conversation in the
browser.

## Starting point and owners

- `plugins/agents/src/server/routes/managed.ts` owns request resolution and idempotency.
- `plugins/agents/src/contract/wire.ts` defines request kinds, payloads, and status.
- `plugins/agents/src/client/sessions/AgentRequestCard.tsx`,
  `plugins/agents/src/client/sessions/requestAnswers.ts`, and
  `plugins/agents/src/client/sessions/appApproval.ts` demonstrate form and answer semantics.

## Implementation steps

1. Add the narrow native request-resolution operation, binding node, session, provider request
   identity, and idempotency key. Use the existing managed API and conflict behavior.

2. Render request title, detail, choices, and full approval context, including
   application/permission scope and warnings. Show pending, resolving, resolved, and expired states.

3. Support the agent contract's question choices, multiple answers, written answers, and secret
   fields. Preserve the existing distinction between question answer labels and permission option
   IDs.

4. Reuse pure answer/presentation helpers where there are demonstrated shared callers. Publish them
   through the owning plugin contract if needed; do not import the host-dependent desktop request
   component.

5. Keep answers ephemeral while editing, with password inputs for secrets. Send them only through
   the privileged sidebar/native operation. Do not persist secret answers in drafts, telemetry, or
   notification text.

6. Refetch after resolution and after an uncertain response. Another client's answer removes the
   pending action. Reject stale submissions and never automatically replay an approval.

7. Recognize unsupported request forms explicitly. Show their full details and an actionable
   explanation rather than inventing a generic approve/deny payload.

## Demo and acceptance

Resolve a real permission request and answer a question from the sidebar. Open the same pending
request in another client and resolve it there first, then confirm the browser updates.

- Verify single/multiple/written and secret answers against real resolution semantics, not only
  rendered markup.
- Exercise permission option IDs, rejection, application scope, request expiry, and unsupported
  forms.
- Resolve concurrently from two clients; confirm one authoritative outcome and no repeated approval.
- Drop the connection during resolution and switch nodes; preserve destination binding and refresh
  before retry.

## Verify and complete

Run request route/runtime tests, extension form and race tests, and affected shared-helper
consumers. Verify real requests in both browsers and run lint.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop at human request review and explicit resolution. Do not add unattended approvals,
page-triggered answers, provider-specific permission policies, or another approval queue.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.
