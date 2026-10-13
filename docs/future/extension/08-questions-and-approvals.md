# Phase 08: questions and approvals

Status: code and tests implemented October 13, 2026. The real-browser checks haven't run; see
[real-browser results](#real-browser-results). [Agent conversations](../../browser-extension/conversations.md#answering-the-agent)
owns the shipped behavior and the `request.resolve` operation.

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
  `plugins/agents/src/contract/appApproval.ts` demonstrate form and answer semantics.

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

## Decisions made while building

The plan was silent or the code disagreed in these places:

- Requests travel inside `session.read` as `requests`, not through a new read. The agents session
  route already returns every request row with each snapshot, and the sidebar already reads the
  session on every hint that names it. An `agent:request` frame already names its session, so a
  request answered elsewhere arrives as an ordinary hint. Phase 09 can read the same rows.
- A read carries every open request and the 10 most recently settled, not the whole list. A long
  session can hold hundreds of requests, and reads happen several times a second while an agent works.
  The settled ones let a request answered elsewhere show as answered rather than vanish.
- Status comes from the request row, not from conversation events. Expiry changes only the row, with
  no event, so a fold of `request` and `request_resolved` events couldn't show it.
- The `appApproval.ts` helpers moved from the agents plugin's `client/` folder to its `contract/`
  folder, the only part other packages may import. The host uses them to describe app access, so the
  desktop and the sidebar say the same thing. The host sends the words rather than the raw approval,
  which keeps the extension free of a dependency on the agents plugin, as phase 02 chose.
- The host checks each request's payload once and marks what the sidebar can't answer as
  `unsupported`, with a reason: a `workflow_gate` or unknown kind, an option or question that doesn't
  read, app access with no readable scope, or nothing to send. Nothing produces a workflow gate yet,
  and its answer may mean something other than a button, so the sidebar doesn't guess.
- A form's answers never come back from the Node. A settled request names only the button it was
  answered with, because a form can hold a secret.
- No request carries `expiresAt`. Nothing on the Node sets it; a request expires when its turn or
  process stops.
- The Node answered a second answer while one was settling, and a button the request never offered,
  with a 500. The agents bridge now maps both to 409 `agent_conflict`, beside its other request-state
  conflicts, so every client shows the Node's reason.
- A stale answer needs no check of its own in the host. The Node settles a row once, in a
  transaction, and answers a settled row unchanged, so a stale press shows the outcome another client
  chose. The host checks the selected Node before sending, as for every write.
- The answer key lives in the card's memory, next to the answer it went with, and is reused only when
  the person sends the same answer again after an uncertain failure. Nothing stores it, so a reconnect
  or a reopened sidebar can't replay it.
- A request shown open stays on screen after it settles, so the person sees what became of it. A
  request that settled before the conversation showed it isn't drawn.
- The "Answer it in the Acorn app" notice for a waiting session is gone. The cards replace it.
- The uncertain-failure codes moved to `isUncertain` in `messages.ts`, shared by the composer and the
  request cards.

## Real-browser results

Not run. On October 13, 2026, the agent session's permission classifier refused the pairing steps of
the development loop: minting a pairing code, pairing the sidebar, and pairing a second device as the
other client. It also refused making a Codex home without James's `approvals_reviewer = "auto_review"`
setting, which is needed for a Codex permission request to reach Acorn. Session `p08-chrome` started
and stopped cleanly, with its development registration removed, but nothing was paired.

These checks are open:

| Check | Chrome | Firefox |
| --- | --- | --- |
| Resolve a real permission request from the sidebar | Not run | Not run |
| Answer a real question: single, multiple, written, and secret answers | Not run | Not run |
| App access scope and warning shown | Not run | Not run |
| Another client resolves first; the sidebar shows it settled with no buttons | Not run | Not run |
| Both clients answer at once; one outcome | Not run | Not run |
| Connection dropped during an answer; read again, no automatic resend | Not run | Not run |
| Node switch during an answer; the answer stays bound to its Node | Not run | Not run |
| Expired request shown as expired | Not run | Not run |
| An unsupported request shown in full with its reason | Not run | Not run |

Unit tests cover each of these against the bridge fake, the host against a fake Node over TLS, and the
Node's conflict mapping. They don't prove browser behavior.

Phase 10's acceptance pass runs these checks with a person present.

