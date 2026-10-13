# Request notifications in the browser extension

This page covers how the [browser extension](../browser-extension.md) tells a person that an agent is
waiting on them: the toolbar badge, the **Waiting for you** list in the sidebar, and opt-in OS
notifications. It covers where the waiting requests come from, which page each one belongs to, what
the extension keeps, and the native operation. The background's side is in
`apps/extension/src/background/requestBadge.ts`, the sidebar's in `src/sidebar/Waiting.tsx`, and the
shared page rule in `src/pageScope.ts`.

## Where the requests come from

The agents plugin keeps each question and permission request as a row, as
[answering the agent](./conversations.md#answering-the-agent) describes. A request is waiting while
its status is `pending` or `resolving`. Nothing else stores them: the badge, the list, and the
notifications are all drawn from that row, read fresh. The extension keeps no copy of the requests.

`GET /v1/p/agents/requests` answers every waiting request on the Node's unarchived sessions, oldest
first, at most 100, each with its session's task. It's device-only, because it spans every task. A
session's `attention` field can't stand in for it. A subagent's tool event sets `attention` to
`unread`, and settling one of two requests sets it to `none`, while a request is still waiting.

The native host's `requests.pending` reads that route and the Node's active tasks, and places each
request in its task's project. A request whose task isn't active has no conversation to open, so it's
left out.

## Which page a request belongs to

A tab's projects are the ones the sidebar's project picker would choose for that page
([project sites](./project-sites.md#suggestions-in-the-sidebar)). `pageScope` in `src/pageScope.ts`
decides it for both the sidebar and the background:

- The person's choice for the page's site, kept in `siteChoices:<nodeId>`, wins. A choice of no
  project means the page has none.
- Otherwise, every visible project whose associations cover the page. Hidden projects don't count.
- A page that reports no address, because the extension may not read it, has none.

Matching runs in the browser. `requests.pending` names only the Node, so no page address goes to the
Node for the badge. A project the person explicitly chose for a conversation doesn't move the badge.
A conversation stays bound across navigation, and the badge follows the page.

## The toolbar badge

The background sets a badge on each tab it may read, with the number of waiting requests for that
tab's projects. The browser shows a tab's badge while the tab is active. A tab it may not read gets no
badge, and the extension asks for no wider access to draw one.

The background opens its native connection as it starts, when a Node is selected, so the badge works
with the sidebar closed. An open native port keeps the background running in both browsers. When a
host that was answering stops, the background starts it once more. A second stop waits until the
person uses the sidebar, so a host that keeps failing can't loop. Once the port closes, the browser
may also stop the background, and its next start connects again.

The badge reads the requests again when:

- A Node is selected, or the selection is restored after the host starts.
- The host's `agent` hint has `requests` set. The host sets it for the agents plugin's
  `plugin:agents:request-changed` frame, which reports every request change, expiry included.
- A hint names a session that has a waiting request, as when that session is archived or deleted.
- A hint has `missed` set, or the selected Node's connection returns.

It reads the visible projects and their associations on selection, on reconnect, and on the `projects`
event. It draws again when a tab navigates, a site grant is added or removed, and the person's site
choices change in `storage.local`.

The count goes to zero at once when the host stops, the selected Node goes offline, a read fails, or
the selection moves to another Node. A count is never older than the Node's own state.

## The waiting list

The sidebar's **Waiting for you** card lists the same requests for the page beside it. When the page
belongs to no project, it lists the project chosen in the picker instead. **Open** chooses the
request's project, task, and conversation, where the request card answers it. The list follows the
page and doesn't move a chosen conversation.

## OS notifications

OS notifications are off until the person ticks **Notify me when an agent waits on the projects of the
page I'm on**. The tick asks the browser for the optional `notifications` permission, and unticking it
removes the permission. The permission is the only setting, so turning it off in the browser's
settings turns it off here too. It's local to the browser profile and separate from the Node's
associations.

With the permission granted, the background notifies once for each waiting request that belongs to the
active tab of any window. The text names only the kind of request: "An agent is asking for
permission." or "An agent has a question for you.", then "Open Acorn to answer." It never carries the
request's title, its detail, a project or task name, an answer, or a page address.

Clicking a notification opens the sidebar and its request's conversation. The background clears the
notification once its request stops waiting.

## Browser storage

The background keeps one key in `storage.local`:

- `notifiedRequests`: `{ nodeId, ids }`, the requests already notified on the selected Node, as
  `<sessionId>:<requestId>`. A restart of the background or the host reads it, so nothing is notified
  twice. A request leaves it once the Node no longer lists it as waiting. Another Node's IDs go when
  the selection moves, with their notifications.

The waiting requests themselves and the site associations stay in the background's memory, and are
read again each time it starts. They aren't stored, because the badge needs the host to draw anything.

## Native operation

| Operation | Fields | Result |
| --- | --- | --- |
| `requests.pending` | `nodeId` | `{ nodeId, requests }`, each `{ requestId, sessionId, taskId, projectId, kind, title, taskTitle }`, oldest first |

The background sends `{ type: 'requests', nodeId, requests }` to each sidebar when the list changes,
and `{ type: 'open', target }` when a notification is clicked. A sidebar that opens after a click gets
the target as it connects.

## Limits

- Chrome lets `sidePanel.open` run only inside a gesture it counts, and Firefox lets
  `sidebarAction.open` run only inside a person's input. A notification click may not count in either
  browser. If the panel doesn't open, the conversation opens when the person next opens the sidebar.
- At most 100 waiting requests are read across the Node, oldest first.
- The real-browser results and their gaps are in
  [phase 09](../future/extension/09-site-notifications.md#real-browser-results).
