# Handoffs in the browser extension

This page covers how the [browser extension](../browser-extension.md) brings an item from a website
into an Acorn task: the site buttons, page access, the sidebar's handoff card, and the native
operations behind them. Plugins declare the buttons; [browser handoffs](../plugin-authoring/browser-handoffs.md)
is their contract. The code is in `apps/extension/src/background/siteButtons.ts`,
`apps/extension/src/content/siteButtons.ts`, `apps/extension/src/sidebar/Handoff.tsx`, and
`apps/cli/src/browser/handoffs.ts`.

## Site buttons

The background keeps the selected Node's handoffs in `storage.local` under `handoffs`, so a page gets
its buttons as it loads, before the native host has started. It reads the list again when the
selection changes, when the selected Node broadcasts `plugins:changed`, and whenever the sidebar
reads it. A list for a Node that is no longer selected is dropped.

For each tab whose address matches a handoff, the background injects `content.js` and tells it which
buttons to draw. The browser reports a tab's address only when the extension may read the tab, so a
tab gets buttons only on:

- **A granted site.** The sidebar lists each site its handoffs are on, with **Allow** or **Remove**.
  **Allow** calls `permissions.request` from the person's click, as the browser requires.
- **The tab the toolbar button was clicked on.** The click grants `activeTab` for that tab, which
  lasts until the tab leaves the site.

The content script draws one button per handoff, at the end of the first anchor that matches and is
drawn, so a header row that a site hides in a narrow window is passed over. It draws the label as
text with its own fixed style, and it puts the button back when the page redraws or navigates within
itself. A page with no visible anchor gets no button; the sidebar still offers the handoff.

A tab that stops matching, loses access, or whose Node is no longer selected is told to draw nothing,
and its buttons go. That happens on navigation, on a removed grant (from the sidebar or the browser's
own settings), on a Node switch, and when the Node forgets the plugin. The content script imports
nothing, because the background injects it as one classic script; the build fails if it would.

## A click

The content script reports only a trusted click: a page that calls `click()` on the button gets
nothing. The background checks the handoff still matches the address the browser reports for the
sending frame, never one the page supplied. Then it opens the panel and hands the sidebar the page:
`{ pluginId, handoffId, label, url }`.

Chrome opens its side panel from the click. Firefox doesn't: `sidebarAction.open` counts only a user
action on the extension's own UI, and a message from a page isn't one. In Firefox the handoff waits
until the person opens the sidebar. A sidebar that is already open gets it at once.

The sidebar also offers each handoff that matches the page beside it, as a button over the Node's
project list. That is the same action for a site whose layout has no anchor, for a handoff that
declares no anchors, such as Linear's and Rollbar's, and for Firefox. The sidebar reads the page again when the tab
finishes loading, so the offer goes when the tab moves to a page it may not read.

## The handoff card

The card resolves the page through `handoff.resolve` and shows what came back:

1. Several items, such as one per connection, mean a choice. Nothing picks the first.
2. **Linked tasks** lists the active tasks that already hold the item. **Open** opens that task's
   newest conversation, or the new-chat picker when it has none.
3. **Create linked task** creates a task in one of the item's projects, chosen from a list when there
   are several, and opens it the same way. A repeated create, with the same key or after the task
   exists, answers the existing task.
4. **Choose another task** leaves the choice to the ordinary project, task, and conversation pickers.
   Choosing a task this way adds no link to it.

Whichever conversation the person opens next gets the item's context in its draft, as an **Item**
capture beside any links, selections, and screenshots. The same item handed off twice is one
capture. Until then the sidebar says the context is waiting, with **Leave it out**. Nothing goes to
an agent until the person sends; the capture becomes a `context` part with `source:
'browser-extension'`, as page captures do ([page capture](./page-capture.md#what-a-capture-is)).

A Node switch clears the card, as it clears the page buttons.

## Native operations

| Operation | Fields | Result |
| --- | --- | --- |
| `handoffs.list` | `nodeId` | `{ nodeId, handoffs }`, each `{ pluginId, id, label, match, anchors }` |
| `handoff.resolve` | `nodeId`, `pluginId`, `handoffId`, `url` | `{ nodeId, url, items }` |
| `handoff.create` | `nodeId`, `pluginId`, `handoffId`, `url`, `identifier`, `connectionId`, `projectId`, `key` | `{ nodeId, task, created }` |

Each item is `{ identifier, url, title, connection, projects, linkedTasks, context }`, with
`projects` as `{ id, name }` and `linkedTasks` as `{ id, title, projectId }`. The task seed stays in
the host. The host also sends `{ v, event: 'handoffs', nodeId }` when the selected Node broadcasts
`plugins:changed`.

The host never takes a route from the browser. For each call it reads `GET /v1/core/browser-handoffs`
again, finds the handoff by plugin and ID, checks its route is inside that plugin's namespace, and
matches the address against the handoff's own patterns before it sends anything. It reads at most
256 KiB of the answer and holds it to the shared schema. `handoff.resolve` is a read, so a reply
after the selection moved is refused as `not_selected`. `handoff.create` is a write: it resolves the
page again and creates from that answer, so the browser never supplies a seed, and a lost answer is
`ambiguous_mutation`, which the card offers to retry with the same key. The rules for linked tasks
and creation are in [browser handoffs](../plugin-authoring/browser-handoffs.md#what-the-host-does-with-the-answer).

## Sites

| Plugin | Pages | Button | Item |
| --- | --- | --- | --- |
| GitHub | Pull requests and their tabs | In the header | One per GitHub account that can see it ([GitHub](../github-integration/tasks-and-references.md#browser-handoff)) |
| Linear | Issues, short and slug addresses | None, sidebar only | One per Linear connection in the page's workspace ([Linear](../integrations/linear.md#browser-handoff)) |
| Rollbar | Item permalinks, `rollbar.com/item/<id>/` | None, sidebar only | One per Rollbar connection whose project has the item, numbered by its project counter ([Rollbar](../integrations/rollbar.md#browser-handoff)) |

## Gaps

- A resolve against GitHub's API wasn't checked in a browser: the session's Node had no GitHub
  connection, and connecting one needs a person. The handoff reached GitHub's route and showed its
  "Connect GitHub" answer. A loaded fixture plugin carried the rest of the flow in both browsers.
- Chrome's site grant wasn't checked, because Chrome's permission prompt can't be answered by a
  driver. Chrome's buttons were checked with the toolbar button's `activeTab`, and grants and removal
  in Firefox.

- A Linear resolution against Linear's API wasn't checked in a browser. The session's Node had only a
  fake Linear key, which Linear rejects, so the handoff showed Linear's "reconnect" answer. Unit tests
  and the Node's parity tests cover a resolution, two workspaces with the same key, and the projects.
- Linear has no in-page button, so there is no button to check. Its handoff is offered in the sidebar.
- The sidebar's site list says "Buttons show on linear.app" after a grant, though Linear draws no
  button. The grant still lets the sidebar read the page. Rollbar's grant reads the same way.
- A Rollbar resolution against Rollbar's API wasn't checked in a browser. Fake tokens reached Rollbar
  and came back as "reconnect". Unit tests and the Node's parity tests cover a resolution.
- Signed out, Rollbar redirects an item's permalink to its login page. The browser checks therefore
  answered the item address with a stub page through the browser's debugging protocol. The handoff
  itself still went through the native host, the Node, and Rollbar's API. The address a signed-in
  item view settles on wasn't seen.

The full results are in [phase 04](../future/extension/04-github-handoff.md#real-browser-results),
[phase 05](../future/extension/05-linear-handoff.md#real-browser-results), and
[phase 06](../future/extension/06-rollbar-handoff.md#real-browser-results).

## Why

Plugins describe a button and a route, and the extension does the rest, so no plugin code runs in a
web page or in the extension. The host looks up the route and re-resolves before creating, so a
compromised page or sidebar can only ask for a handoff the Node declared, on a page it matches, into
a project the provider tied to the item.
