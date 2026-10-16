# Handoffs in the browser extension

This page covers how the [browser extension](../browser-extension.md) brings an item from a website
into an Acorn task: the task chip on the page, page access, the handoff card in Home's **This page**
section, the panel's verbs and its `acorn://` links, and the native operations behind them. How a page
is matched to the task it belongs to is in [pages matched to tasks](./task-pages.md). Plugins declare
the pages and anchors; [browser handoffs](../plugin-authoring/browser-handoffs.md) is their contract.
The code is in `apps/extension/src/background/siteButtons.ts`, `apps/extension/src/content/siteButtons.ts`,
`apps/extension/src/sidebar/Handoff.tsx`, and `apps/cli/src/browser/handoffs.ts`.

## Task chips

The background keeps the selected Node's handoffs in `storage.local` under `handoffs`, so a page gets
its chip as it loads, before the native host has started. It reads the list again when the
selection changes, when the selected Node broadcasts `plugins:changed`, and whenever the sidebar
reads it. A list for a Node that is no longer selected is dropped.

For each tab whose address matches a handoff, the background injects `content.js` and tells it which
chips to draw. The same script draws the [branch marker](./task-pages.md#the-branch-marker) on an app
a plugin published for a task, under the same access rules. Injecting a script needs access to the
page's site, so a tab gets a chip only on:

- **A granted site.** **Sites** in the sidebar's Settings lists each site its handoffs, project
  associations, and tasks' apps are on, what the extension does there (task chips on its pages,
  looking up items, [project suggestions](./project-sites.md#settings--sites), or the branch marker),
  and a switch for access. Turning it on calls `permissions.request` from the person's click, as the
  browser requires.
- **The tab the toolbar button was clicked on.** The click grants `activeTab` for that tab, which
  lasts until the tab leaves the site.

The content script draws one chip per handoff, at the end of the first anchor that matches and is
drawn, so a header row that a site hides in a narrow window is passed over. It puts the chip back
when the page redraws or navigates within itself. A page with no visible anchor gets no chip; the
sidebar still offers the handoff.

The chip draws inside a closed shadow root, so the page's CSS can't restyle it and none of its own
leaks out. It takes the height of the site's buttons beside it and the page's light or dark theme,
read from the anchor's text colour, and borrows only Acorn's mark, the task name in a monospaced
face, and the state dot's colours. Everything a plugin or the Node supplied goes in as text; the
plugin's `label` stays in the chip's accessible name.

- **A page that belongs to a task** shows the task's name and its agents: **2 working**, or
  **1 waiting** in the warning colour when an agent waits on the person. The background reads the
  conversations of each task an open page shows, and again when a hint names that task or one of its
  conversations. A conversation is waiting while the Node holds a request from it. A click opens the
  panel on the task. The arrow beside it opens a menu: **Show in side panel**, **Open in
  Acorn** (a plain `acorn://` link to the task, on its item's pane), **New chat about this page**
  (the task's **Agents** tab, with the page's link waiting for the task's first chat), **Ask about an
  element** (the [element picker](./element-picker.md)), and **Copy Acorn link**. A development
  build leaves out Open in Acorn, as the panel does.
- **A page no task holds** reads **Start task**. A click opens a menu with the desktop row menu's two
  choices: **Create task** and **Start workflow…**. Either one opens the panel on the handoff card,
  which resolves the page. **Start workflow…** opens it with the project's first workflow chosen.

Firefox opens its sidebar only from the extension's own controls, so there the chip's click opens
the menu, with a line saying to click Acorn in the toolbar for the panel. A task's menu has Open in
Acorn as a plain link, Ask about an element, and Copy Acorn link. Start task's choice hands the page
to the background, and the handoff card shows when the person opens the sidebar.

A tab that stops matching, loses access, or whose Node is no longer selected is told to draw nothing,
and its chip goes. That happens on navigation, on a removed grant (from the sidebar or the browser's
own settings), on a Node switch, and when the Node forgets the plugin. The content script imports
nothing, because the background injects it as one classic script; the build fails if it would.

## A click

The content script reports only a trusted click: a page that calls `click()` on the chip gets
nothing. The background checks the handoff still matches the address the browser reports for the
sending frame, never one the page supplied, and for a task chip that the page still belongs to a
task. Then it opens the panel and hands the sidebar either the page, `{ type: 'handoff', handoff:
{ pluginId, handoffId, label, url, start } }`, or a request to show the page's task, `{ type: 'showTask',
chat }`, where `chat` is the page's address and title for New chat about this page and null
otherwise. `start` is `task` or `workflow`, from the menu. The page sends it, so the background
passes on only those two values.

Chrome opens its side panel from the click. Firefox doesn't: `sidebarAction.open` counts only a user
action on the extension's own UI, and a message from a page isn't one. A sidebar that is already open
gets the click at once, and one that opens later gets the latest of each kind as it connects.

## The handoff card

The card shows in Home's [**This page**](./task-pages.md#this-page) section, in place of its state. Home
opens it for a page a handoff matches and no task holds, and a chip's click brings it forward. It
resolves the page through `handoff.resolve` and draws the item in the kit's `Card`:

1. The head: the plugin's logo (only the kit's own, such as GitHub's; others show a document), the
   item's key and connection, its title, and **Open in Acorn** as an arrow, through `open?url=`.
   Several items, such as one per connection, put a kit `Picker` in place of the key.
2. An item a task already holds shows that task as This page's task row, which opens it.
3. Otherwise, the project: its name, or a **Project** picker under **Tracks this issue** when several
   track the item. They're the plugin's, plus any whose [site associations](./project-sites.md#handoffs)
   cover the page, unless the item carries a pull number. **Create task** creates the linked task
   with `handoff.create` and opens it on **Agents**. **Run workflow** picks one of the project's
   workflows.

A chosen workflow adds a **Workflow** picker, a field per input with a red asterisk when required
and its description as the placeholder, filled from the item, then **Start run** and **Cancel**.
**Start run** creates the task, starts the run, and opens **Runs** with the run open
([workflows](./workflows.md#starting-a-workflow)). **Cancel** removes the part and what was typed.

The card has no **Dismiss**. It closes when the tab leaves the item, and Home looks the item up again
each time it shows the page. A page still shows the item when it matches the same handoff and every
capture the two addresses share is equal, so a pull request's **Files** tab keeps the card. A typed
workflow input or a start under way keeps it open, saying the page was left. Its writes keep their
keys, so pressing again after one went unconfirmed makes no second task or run. A Node switch clears
the card, as it clears the page buttons.

### The item waiting for the first chat

After **Create task**, the task's **Agents** tab shows the item as a chip with ×, such as **Item ·
Fix the flaky test**, in its empty state, or above its conversations when the task has some. It belongs to that task alone, under `pendingItem:<nodeId>:<taskId>` in
`storage.local`, as does the page link the chip's **New chat about this page** leaves. The next
conversation opened or started in the task takes it into its draft as a capture, once however often
it's handed off. × drops it, as does the task leaving the Node's list while the panel is open.
Nothing goes to an agent until the person sends: the capture becomes a `context` part with
`source: 'browser-extension'` ([page capture](./page-capture.md#what-a-capture-is)).

## The panel's verbs

Each verb means one thing wherever it shows:

| Verb | What it does |
| --- | --- |
| **Open in Acorn** | Opens the desktop app through an [`acorn://` link](../frontend/acorn-links.md): a task on its item's pane (GitHub's for a pull request), a conversation on the agents pane, a project, or a handed-off item through `open?url=`. |
| **Copy Acorn link** | Copies that link. |
| **Create task** | Creates the item's linked task and opens it on **Agents**, with the item waiting for its first conversation ([the handoff card](#the-handoff-card)). |
| **Start run** | Creates the item's linked task, starts the chosen workflow in it, and opens its **Runs** ([workflows](./workflows.md)). |
| **New chat** | Starts a conversation in the task with a chosen agent. |
| **Add to chat** | Captures the page link, a selection, or a screenshot into the draft. |

Open in Acorn follows its link as a plain link does, which both browsers hand to the app registered
for `acorn://`, with no extension permission. Only a release desktop registers the scheme, and it opens only a Node that
desktop is paired with, as the bridge's Node ID names it. A development build, one that talks to the
development bridge, shows Copy Acorn link in its place. `src/acornLinks.ts` builds the links with
client-core's `buildLink` for the panel and the task chip, and holds the table of item panes by plugin.

## Native operations

| Operation | Fields | Result |
| --- | --- | --- |
| `handoffs.list` | `nodeId` | `{ nodeId, handoffs, panels }`: each handoff `{ pluginId, id, label, match, anchors }`, and each [plugin panel](./plugin-panels.md) `{ pluginId, label, glyph, pane }` |
| `handoff.resolve` | `nodeId`, `pluginId`, `handoffId`, `url` | `{ nodeId, url, items }` |
| `handoff.create` | `nodeId`, `pluginId`, `handoffId`, `url`, `identifier`, `connectionId`, `projectId`, `key` | `{ nodeId, task, created }` |

Each item is `{ identifier, url, title, connection, projects, linkedTasks, context }`, with
`projects` as `{ id, name }` and `linkedTasks` as `{ id, title, projectId }`. The task seed stays in
the host. The host also sends `{ v, event: 'handoffs', nodeId }` when the selected Node broadcasts
`plugins:changed`. [Pages matched to tasks](./task-pages.md#native-operation) covers `tasks.pages`.

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
| GitHub | Pull requests and their tabs | A task chip in the header | One per GitHub account that can see it ([GitHub](../github-integration/tasks-and-references.md#browser-handoff)) |
| Linear | Issues, short and slug addresses | None, sidebar only | One per Linear connection in the page's workspace ([Linear](../integrations/linear.md#browser-handoff)) |
| Rollbar | Item permalinks, `rollbar.com/item/<id>/` | None, sidebar only | One per Rollbar connection whose project has the item, numbered by its project counter ([Rollbar](../integrations/rollbar.md#browser-handoff)) |

## Gaps

- The chip was checked in Chrome on a public pull request, with and without a task, including its
  menu, New chat about this page, Start task, and the chip changing when the task was archived.
  Start task's menu, with Create task and Start workflow…, was checked in unit tests only.
  Firefox's chip and menu were checked in unit tests only. A chip's working and waiting counts were
  checked in unit tests only, because the session's Node ran no agent.
- A page matches a task's address exactly, path case included. GitHub serves `Acme/Runn` and
  `acme/runn` as one repository, so a pull request opened under another spelling of the project's
  repository doesn't match. Linear's link records the issue's slug address, so the short address
  `linear.app/<workspace>/issue/<key>` doesn't match until Linear redirects to the slug.
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
- A Rollbar resolution against Rollbar's API wasn't checked in a browser. Fake tokens reached Rollbar
  and came back as "reconnect". Unit tests and the Node's parity tests cover a resolution.
- Signed out, Rollbar redirects an item's permalink to its login page. The browser checks therefore
  answered the item address with a stub page through the browser's debugging protocol. The handoff
  itself still went through the native host, the Node, and Rollbar's API. The address a signed-in
  item view settles on wasn't seen.

## Why

Plugins describe a button and a route, and the extension does the rest, so no plugin code runs in a
web page or in the extension. The host looks up the route and re-resolves before creating, so a
compromised page or sidebar can only ask for a handoff the Node declared, on a page it matches, into
a project the provider tied to the item.
