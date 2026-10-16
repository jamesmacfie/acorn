# Browser handoffs

This page covers `browserHandoffs`, the contribution that puts a task chip on a website, and
`taskAddresses`, which tells the extension where a task's app answers. The
[browser extension](../browser-extension.md) draws it: on a page that belongs to a task it shows the
task and its agents, and on any other page a click brings the page's item into an Acorn task. It's part of [plugin authoring](../plugin-authoring.md). The extension's side is in
[handoffs in the browser extension](../browser-extension/handoffs.md).

## What a plugin declares

A plugin declares data only: the pages, the chip's label, where the chip goes, and one route on its
own Node half. It ships no browser code. The extension owns the chip's markup, its look, when it
appears, and what a click does. A click never sends anything to an agent: it puts the item in
front of the person, who picks a task and reviews a draft.

Put this descriptor inside `contributions.browserHandoffs` in `acorn-plugin.json`, or in
`acorn-plugin.config.mjs` for a built package. The manifest also needs a `node` entry to serve the
route. This is one array element:

```json
{
  "id": "issue",
  "label": "Open in Acorn",
  "match": ["https://tracker.example/{team}/issue/{key}"],
  "anchors": [".issue-header .actions", ".issue-header"],
  "resolve": "/v1/p/tracker/browser/issue"
}
```

| Field | Rule |
| --- | --- |
| `id` | Lowercase letters, digits, and hyphens, at most 64 characters, unique among this plugin's contributions. |
| `label` | 1 to 40 characters. The chip shows the task's name or **Start task**, and keeps the label in its accessible name. The extension uses it as text, never as markup. |
| `match` | 1 to 8 page addresses in the [content-link grammar](../plugins/descriptors.md#content-links): `https://` only, a literal host or one `*.` level, and literal, `{capture}`, or one `{capture+}` path segments. A `{capture+}` takes one or more segments and comes right before a literal, as in `https://gitlab.com/{path+}/-/merge_requests/{number}`. Otherwise the page must have exactly as many segments as the pattern, and one trailing slash is allowed. Declare one pattern per arity. A [self-hosted code host](../plugins/self-hosted-code-hosts.md) can write `{codeHost}` as the host, which discovery expands into one pattern per host it holds. |
| `anchors` | Up to 4 CSS selectors, each at most 200 characters. The chip goes at the end of the first element that matches and is drawn. A selector can't contain `{`, `}`, `;`, `<`, or a control character. Leave it empty to offer the handoff in the sidebar only. |
| `resolve` | A route inside this plugin's own `/v1/p/<pluginId>/` namespace. |

A plugin may declare up to 4. The Node refuses the whole manifest when a rule fails, as it does for
any other contribution.

A compiled plugin declares the same descriptors on `NodePlugin.browserHandoffs`, beside `emits`.
Both tiers pass the same schema and the same route check, so the extension can't tell them apart.
GitHub is the compiled example: its descriptor is in `plugins/github/src/node/index.ts`, and its route,
loaded on first use, in `plugins/github/src/server/browserHandoff.ts`.
Linear is the loaded example: its descriptor is in `plugins/linear/acorn-plugin.config.mjs` and its
route in `plugins/linear/src/server/browserHandoff.ts`.
`packages/node-core/src/server/plugins/__fixtures__/handoffPlugin.mjs` is a minimal loaded one.

## The resolve route

The browser's native host calls `resolve` with `POST` and this body:

```json
{ "url": "https://tracker.example/acme/issue/ENG-42", "captures": { "team": "acme", "key": "ENG-42" } }
```

The host matched `captures` from one of the handoff's own patterns. Treat them as the only identity
the page supplies, and look the item up with the person's credentials, through
`context.providers.withConnections` or your own provider routes. Don't scrape page text.

Answer with `{ items }`, at most 8, each with these fields:

| Field | Meaning |
| --- | --- |
| `identifier` | The provider's own name for the item, such as `acme/widget#12` or `ENG-42`. At most 300 characters. |
| `url` | The item's `https://` address. |
| `title` | What the sidebar shows, at most 300 characters. |
| `connection` | `{ id, label }` of the connection that resolved it. Two connections that can both see the item are two items, and the person picks one. |
| `projects` | Up to 16 project IDs the provider can tie the item to. A task is created only in one of these, or in a project whose [site associations](../browser-extension/project-sites.md) cover the page when the seed has no `pullNumber`. Empty means none from the provider; the person can still choose any task themselves. |
| `seed` | The core task seed without `projectId`: `origin`, and optionally `title`, `branch`, `pullNumber`, and up to 8 connection-stamped `links` (`{ connectionId, identifier, ref? }`). |
| `context` | Optional `{ label, content }` for the agent to read, at most 16,000 characters of content. It goes into the person's draft for review. |

The whole answer must stay under 256 KiB. The host refuses an answer that doesn't parse, and the
sidebar says the plugin answered with something it can't use. Answer an error the way other routes
do, as `{ error: { code, message } }` with an error status. The sidebar shows the message, so say what
the person can do, such as connecting an account or trying again in a minute.

Don't answer 401, even for a provider key that needs reconnecting. The host reads a 401 as the Node
refusing the browser itself, and tells the person to pair again. Use 403 for a provider credential.

A loaded plugin that registers a provider with a fetch route through `ctx.providers.integration`
must serve `resolve` from that same router. The provider's router answers every path under
`/v1/p/<pluginId>` over HTTP, so a separate `ctx.routes.fetch` mount is never reached from the
browser. Linear's route is in its provider router for this reason.

Ask every connection, not the first that answers, and check the page's own scope against the
provider's answer. A key like `ENG-42` can exist in two workspaces, and only one of them is the page
the person is looking at. Linear compares the workspace in the address with the workspace in
Linear's own address for the issue.

The number in an address may not be the one your task links use. Rollbar's permalink names an item
by its system-wide id, and its links use the project's counter. Its route
(`plugins/rollbar/src/server/browserHandoff.ts`) reads the item by the id and takes the counter from
Rollbar's answer, never from the address.

## What the host does with the answer

The extension never sees the route or the seed. The host:

- Finds the item's linked tasks among the Node's active tasks. A task that holds one of the seed's
  `links` is linked in any project. A task with the seed's `pullNumber` is linked only in one of the
  item's `projects`, because a number alone names another item in any other repository.
- Shows the projects by name, dropping any the Node no longer has. When the seed has no `pullNumber`,
  it adds every project whose site associations cover the page. A pull number names a pull request
  only in its own repository, so an item with one keeps to your `projects`.
- On **Start task**, resolves the page again, finds the chosen item by `identifier` and
  connection, refuses a project that is neither in its `projects` nor covered by that project's site
  associations, and answers an already-linked task in that
  project instead of creating another. Otherwise it sends `POST /v1/core/tasks` with the seed, the
  project, and the sidebar's idempotency key.

Core stamps each link's provider from its connection and refuses a connection the caller doesn't
own, as it does for any task created with links.

## How a page finds its task

The extension knows which task a page belongs to without calling your route. The Node's task list
already holds each task's items, and the bridge's `tasks.pages` read turns them into addresses the
extension matches in the browser ([pages that belong to a
task](../browser-extension/task-pages.md#pages-that-belong-to-a-task)). For your items to match:

- Give each link in the seed a `ref.url`, the item's own `https://` address, as Linear and Rollbar
  do. A link with no address can still be found by `resolve`, but no page shows its task's chip.
- Use the address people land on. The match is exact on the origin and by whole path segments, so the
  item's address covers its sub-pages, and nothing covers a second spelling of it.

A pull request needs no link: core records it as the project's repository and the task's pull
number, and the bridge builds its GitHub address.

## Task addresses

A plugin that runs something for a task, such as a local stack or a dev server, can say which exact
origin that app answers at while it runs. The extension then knows the app's tabs belong to the task:
**This page** shows the task with your state line, and the page gets a
[branch marker](../browser-extension/task-pages.md#the-branch-marker). Runn is the example: it
publishes `RUNN_APP_URL` from each worktree's `.runn/project.env` while the stack is up.

Declare one route in the manifest. The manifest also needs a `node` entry:

```json
{ "contributions": { "taskAddresses": "/v1/p/devserver/task-addresses" } }
```

The route must be inside your own `/v1/p/<pluginId>/` namespace. Only a loaded plugin declares one.
The browser's native host calls it with `GET` and a device credential whenever it reads the Node's
task pages, so refuse a task-scoped caller. Answer with `{ addresses }`, at most 64, each with:

| Field | Meaning |
| --- | --- |
| `taskId` | An active task. An address for any other task is dropped. |
| `origin` | An exact `http` or `https` origin on a loopback host (`localhost`, a `*.localhost` name, `127.x.x.x`, or `[::1]`), in the form a browser reports it, port included and no path, such as `https://runn-05ea41.runn.localhost:5104`. `https://github.com`, `https://app.localhost:443`, and `https://app.localhost/x` are refused. |
| `label` | What answers there, 1 to 40 characters, such as `Runn stack`. |
| `state` | Its state, 1 to 40 characters, read after the label as one line: `Runn stack running`. The marker shows it alone, so write it in lower case. |
| `severity` | `info` for a healthy state, `warn` for one to check, `danger` for a failure, as [annotations](../plugins/rows-and-annotations.md#annotations) use them. |

Parse your answer with `taskAddressList` from `@acorn/protocol/plugin/handoffs.ts`, the schema the
host applies. The host refuses the whole answer when one entry fails, keeps it under 64 KiB, and
skips your plugin when the route fails, so other plugins' addresses still show.

List an address only while the app answers, and leave it out once it stops. The extension never
polls. It reads your route again when a task changes and when you call `ctx.events.status()`, so call
it when your app comes up or goes down. Runn calls it when a command changes the stack, and a few
seconds later while health checks are still settling.

The extension matches pages against an address in the browser, so no page address goes to the Node
for it, and the person still decides which sites the extension may read.

## Discovery and activation

`GET /v1/core/browser-handoffs` lists every running plugin's handoffs, each with its `pluginId`, its
task address routes as `taskAddresses: [{ pluginId, route }]`, and its [sidebar panel](./browser-panel.md) under `panels`.
`codeHosts` lists the ids of the running [code hosts](../plugins/code-hosts.md), whose task addresses match in any case. It is device-only. A package waiting for review isn't listed until it runs, a disabled or failed plugin isn't listed,
and a reload replaces the list with the new version's. A `{codeHost}` pattern is expanded on each read, so a host a code host claims or releases is in or out of the list at once. The host broadcasts `plugins:changed` on each of these, and the extension reads the list again. A company server's pages still need the person to grant the extension that site.

## Ship a handoff

A handoff reaches a person only through a Node that runs your plugin and a browser paired with that
Node:

1. Declare the descriptor and serve `resolve` from your Node half, then test the route as below.
2. Get the plugin running on the Node. A compiled plugin ships with every Node. The desktop also
   bundles some loaded packages, Linear and Rollbar among them, but a standalone Node runs a loaded
   package only after it is installed there.
3. Check discovery: `GET /v1/core/browser-handoffs` from a paired client lists your descriptor.
4. Check the page in a browser with [the development loop](../local-development/extension-dev-loop.md#check-task-chips),
   including the sidebar's offer when no anchor matches.

Choose anchors you have seen on the live site, signed in, at more than one window width. Sites hide
rows at some widths, and a page that needs a sign-in can't be checked without one. With no anchor you
can trust, leave `anchors` empty, and the sidebar offers the handoff instead.

## Test a handoff

- Parse the route's answer with `browserHandoffResolution` from
  `@acorn/protocol/plugin/handoffs.ts`, the schema the host applies.
- Check your patterns with `matchHandoffPage` from the same module.
- `packages/node-core/src/server/plugins/browserHandoffs.test.ts` loads a package from disk, runs its
  resolve and task address routes in the real plugin worker, and parses both answers. Copy it for a
  loaded plugin.
- In a browser, use [the extension development loop](../local-development/extension-dev-loop.md#check-task-chips).
