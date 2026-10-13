# Browser handoffs

This page covers `browserHandoffs`, the contribution that puts a button on a website. The
[browser extension](../browser-extension.md) draws it, and a click brings the page's item into an
Acorn task. It's part of [plugin authoring](../plugin-authoring.md). The extension's side is in
[handoffs in the browser extension](../browser-extension/handoffs.md).

## What a plugin declares

A plugin declares data only: the pages, the button's label, where the button goes, and one route on
its own Node half. It ships no browser code. The extension owns the button's markup, its look, when
it appears, and what a click does. A click never sends anything to an agent: it puts the item in
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
| `label` | The button's text, 1 to 40 characters. The extension draws it as text, never as markup. |
| `match` | 1 to 8 page addresses in the [content-link grammar](../plugins/descriptors.md#content-links): `https://` only, a literal host or one `*.` level, and literal or `{capture}` path segments. The page must have exactly as many segments as the pattern, and one trailing slash is allowed. Declare one pattern per arity. |
| `anchors` | Up to 4 CSS selectors, each at most 200 characters. The button goes at the end of the first element that matches and is drawn. A selector can't contain `{`, `}`, `;`, `<`, or a control character. Leave it empty to offer the handoff in the sidebar only. |
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
| `projects` | Up to 16 project IDs the provider can tie the item to. A task is created only in one of these. Empty means none; the person can still choose any task themselves. |
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
- Shows the projects by name, dropping any the Node no longer has.
- On **Create linked task**, resolves the page again, finds the chosen item by `identifier` and
  connection, refuses a project not in its `projects`, and answers an already-linked task in that
  project instead of creating another. Otherwise it sends `POST /v1/core/tasks` with the seed, the
  project, and the sidebar's idempotency key.

Core stamps each link's provider from its connection and refuses a connection the caller doesn't
own, as it does for any task created with links.

## Discovery and activation

`GET /v1/core/browser-handoffs` lists every running plugin's handoffs, each with its `pluginId`. It is
device-only. A package waiting for review or a restart isn't listed until it runs, a disabled or
failed plugin isn't listed, and a reload replaces the list with the new version's. The host
broadcasts `plugins:changed` on each of these, and the extension reads the list again.

## Test a handoff

- Parse the route's answer with `browserHandoffResolution` from
  `@acorn/protocol/plugin/handoffs.ts`, the schema the host applies.
- Check your patterns with `matchHandoffPage` from the same module.
- `packages/node-core/src/server/plugins/browserHandoffs.test.ts` loads a package from disk, runs its
  route in the real plugin worker, and parses the answer. Copy it for a loaded plugin.
- In a browser, use [the extension development loop](../local-development/extension-dev-loop.md#check-site-buttons).
