# Phase 09: site notifications

Status: implemented October 13, 2026, with the real-browser gaps listed in
[real-browser results](#real-browser-results). [Request notifications](../../browser-extension/notifications.md)
owns the shipped behavior and the `requests.pending` operation.

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

## Decisions made while building

The plan was silent or the code disagreed in these places:

- The open requests come from one new agents route, `GET /v1/p/agents/requests`, device-only, which
  answers every `pending` or `resolving` request on unarchived sessions with its session's task, oldest
  first, at most 100. Step 3 allowed it. The cheaper filter the phase 08 notes suggested, the session
  row's `attention`, can be wrong while a request waits: a subagent's tool event sets it to `unread`,
  and settling one of two requests sets it to `none`. One `session.read` per session would have meant
  reading every session of every scoped task, events and turns included, on every hint.
- The host's `requests.pending` places each request in a project through the active task list, and
  drops a task that isn't active. The browser sends only the Node ID, so no page address or project
  list goes to the Node.
- Request changes travel as a `requests` flag on the existing `agent` hint. The host sets it for the
  agents plugin's `plugin:agents:request-changed` frame, the only frame that reports expiry. A hint
  naming a session that holds a waiting request also reads again, which covers an archived or
  deleted session. No second event or notification store.
- The background keeps the site associations and visible projects in memory, not in `storage.local`
  as the phase 07 notes suggested. The handoff list is stored so pages get buttons before the host
  starts. A badge can't draw anything before the host starts, so a stored copy would only add a second
  thing to keep in step. The background reads both on selection, reconnect, and `projects` events.
- Which projects a page belongs to moved out of the sidebar into `pageScope` in
  `apps/extension/src/pageScope.ts`, with the site-choice helpers. The sidebar's picker and the badge
  use the same rule, hidden projects and overrides included, so they can't disagree.
- The badge is set per tab, on every tab the extension may read, so each window's active tab shows its
  own count. A tab it may not read shows none, and the extension asks for no wider access.
- The background opens the native port as it starts when a Node is selected. That is the lifetime
  behavior step 1 asks for: an open native port keeps a Chrome service worker and a Firefox event page
  running. After the port closes, the browser may stop the background, and its next start, on any tab
  event it listens to, connects again. Nothing restarts the host on a timer.
- A host that stops after it was answering is started once more on its own; a second stop waits for
  the sidebar. Without it, a crashed host left the badge empty for as long as tab events kept the
  service worker awake, because only a sidebar call reconnected.
- The count drops to nothing at once when the host stops, the Node goes offline, a read fails, or the
  selection moves. The delivered-notification list isn't pruned then, so a reconnect doesn't notify
  again.
- The OS notification opt-in is the browser's optional `notifications` permission, with no separate
  setting. Revoking it in the browser's settings is the mute.
- A notification goes out for a request that belongs to any window's active tab, once, and says only
  the kind of request. Delivered IDs are kept per Node in `notifiedRequests`, pruned to the Node's
  waiting list on each read. The icon is a 128-pixel copy of the desktop icon in
  `apps/extension/public/`, because Chrome refuses a basic notification without one.
- The sidebar's **Waiting for you** list shows the page's projects. When the page belongs to none, it
  shows the project chosen in the picker. That is the "explicitly selects a scope" of step 7. The
  badge and the OS notifications never fall back to the picker, so a conversation pinned on another
  site never moves them.
- A clicked notification opens the panel if the browser allows it and hands the request's project,
  task, and conversation to the sidebar, now or when it next connects.
- The waiting list shows the request's title and task. Those stay in the sidebar, a privileged page,
  as the request cards already do. Only the OS text is generic.

## Real-browser results

October 13, 2026, with Chrome 155.0.8059.40 and Firefox 151.0.3 on macOS. Chrome session `p09-chrome`
ran through `pnpm dev:extension`, and pairing through `dev:extension:ui` went through this time.
Firefox went straight to the WebDriver BiDi route, because web-ext's read of Firefox's `profiles.ini` is
denied in the agent sandbox: session `p09-firefox`, the development build, the host registered with
`acorn browser install --development`, Firefox started with `open`, the extension installed over BiDi,
and the Node of `p09-chrome`, paired separately.

A second paired device, the other client, added two plain-folder projects: `web` with
`https://example.com/app`, and `docs` with `https://example.com/docs`, each with one task. Every waiting
request was real: a Codex turn in plan mode asked a question through `request_user_input`. Chrome's
toolbar click ran through CDP's `Extensions.triggerAction`, which grants `activeTab`, and the panel was
closed again with `chrome.sidePanel.close`. Badges were read in Chrome from the service worker over
CDP while it was the only extension context. In Firefox, the site grant and the opt-in were pressed with
BiDi pointer input, with `extensions.webextOptionalPermissionPrompts` off, and the state was read from a
sidebar tab in another window, opened after the background had acted.

| Check | Chrome | Firefox |
| --- | --- | --- |
| No access to the page: no address, no badge | Passed | n/a |
| Sidebar closed on `/app/settings`, a `web` question waiting: badge `1` | Passed | Passed |
| Same domain: `/docs/intro` shows nothing for the `web` request; back on `/app`, `1` | Passed | Not repeated |
| A `docs` question too: `/app` and `/docs/intro` each show `1`, their own | Passed | Not repeated |
| Answered from another client: the `docs` badge clears | Passed (from the other device) | Passed (answered in Chrome's sidebar) |
| Override: choosing `docs` on `/app` clears the badge; choosing `web` again brings it back | Passed | Not repeated |
| **Waiting for you** lists the page's request; **Open** opens its task and conversation | Passed | Not repeated |
| A conversation open in `web` stays bound on `/docs/intro`; the list and badge follow the page | Passed | Not repeated |
| Answering in the sidebar's request card clears the badge; the Node holds the answer | Passed | n/a |
| A request that expires when its turn is cancelled clears the badge | Passed | Passed |
| Native host killed: a new host starts by itself, and the badge comes back | Passed (panel closed) | Passed |
| Background restarted (extension reload): the host starts with no sidebar, the badge comes back | Passed | Passed |
| Access lost, by leaving the site in Chrome or **Remove** in Firefox: the badge goes | Passed | Passed |
| Opt-in granted by the person's click | Gap | Passed |
| One OS notification, "An agent has a question for you. Open Acorn to answer.", with no request content | Gap | Passed |
| No second notification after a host restart or an extension reload | Gap | Passed |
| Unticking the opt-in removes the permission | Gap | Passed |
| A notification's click opens the sidebar on its conversation | Gap | Gap |

Two bugs turned up and were fixed before these results:

- The toolbar click grants a tab with no tab or permission event, so the badge didn't draw until the
  page navigated. The background now draws the clicked tab.
- In Firefox, `tabs.query({ active: true })` answered the granted page without its address, so no
  notification went out. Delivery now filters the full tab list.

These gaps remain:

- Chrome's notifications. Chrome asks the person before it grants `notifications`, and a driver
  can't answer the prompt, so Chrome delivered none. Firefox covered delivery, the text, and
  deduplication.
- A notification's click, in both browsers. A driver can't click an OS notification. Unit tests cover
  the click handing its conversation to an open or later sidebar. Whether a click counts as the
  gesture `sidePanel.open` and `sidebarAction.open` need is unmeasured; the conversation still opens
  when the person opens the sidebar.
- The text as macOS draws it, and a locked screen. Only the extension's own record of the notification
  was read.
- A second Node switch during reads in a browser. Unit tests cover dropping one Node's list for another.
- Firefox's first native port after start didn't stall in this session.
- Firefox reload on save and session stop through `pnpm dev:extension`, for the sandbox reason above.

Phase 10's acceptance pass runs the gaps with a person present.
