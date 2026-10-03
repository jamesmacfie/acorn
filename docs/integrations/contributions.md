# Connection and integration contributions

A provider plugin registers one of two contribution types. This page covers what each holds, the item
detail, comment, and image hooks behind core's agent tools, and the shared row menu. The registries
are in `packages/node-core/src/server/integrations/`.

## Connection and integration contributions

Every provider registers a `ConnectionProviderContribution`: connection lifecycle, capabilities,
request budgets, and optionally a project source and a model catalog. A provider that also mirrors
external items, such as GitHub or Linear, extends it into an `IntegrationProviderContribution`. That
adds the external ID contract, mirrored resources, a codec, task context formatting, item detail, the
comment and image hooks, and reference resolution. The connection registry holds every provider, and
the integration registry holds only those that extend it. OpenAI and Anthropic are in the connection
registry only, because they mirror nothing.

`projects` is on the base contribution, because whether a connection can be scoped to projects doesn't
depend on mirroring ([project sources](./project-sources.md)). A provider with nothing to list declares
nothing.

A route reaches core state only through `ExternalItemStore` (`itemStore.ts`), scoped to one provider,
not through core's database handle. That keeps a route to its own rows in the external-item cache, and
keeps Linear's and Rollbar's code out of core migrations.

## Item detail

`detail` is the read behind core's `issue_detail` agent tool. Given an identifier, it returns
everything the provider has on that item, or `null` if this connection doesn't have it. Core calls it
once per connected workspace and takes the first answer. The provider composes its own resources
through the one method core lends it: Linear reads the issue, and Rollbar reads the item, its
occurrences, and the newest occurrence. A provider whose items have no body declares nothing, and
offers summaries only. [Tracker tools](../agent-tools/tracker-tools.md#issuedetail) has the full
contract.

Core also calls `detail` when a task gains a link, without waiting on it. That fills the cache, so the
task context names each linked item by title and state. A failure leaves the item uncached.

## Comments and images

Two more hooks sit beside `detail`, and each turns on a core agent tool. A tracker declares the hook
and writes no tool code:

- `comment(context, identifier, body)` is the write behind `issue_comment`. It posts `body` as the
  person who owns the connection and returns the comment's URL, or `null` when this connection has no
  such item. The context carries the unsealed key, the same `resource` method `detail` gets, and an
  `idempotencyKey`, the agent's tool call ID. A tracker that accepts a client-chosen comment ID uses
  it, so a retry can't post twice. The registry refuses `capabilities.comments: 'write'` without
  `comment`, and the reverse.
- `image(context, url)` is the read behind `issue_image`. It returns `{ mimeType, data }` in base64,
  or `null` when the URL isn't one this provider fetches. Linear accepts only its private upload host.
  Core checks the type and size, and first checks that the URL appears in the item's detail, so
  `image` requires `detail`.

Both tools act only on an item linked to the task, and get the connection from the link. The hooks run
inside core's secret scope with the owner's key, so a loaded plugin can offer them even though its own
routes refuse task-scoped callers the credential.

## The row menu

Every integration list draws the same overflow menu on a row, from the context menu registry's
`item.row` location ([context menus](../plugins/menus-and-markers.md#context-menus)).
Core's rail list draws it for Linear and Rollbar, and the GitHub pull request list draws its own, both
filled from one registry. **Create task** is core's, or GitHub's for a pull request. **Start
workflow…** is the workflows plugin's ([starting a run](../workflows/starting-runs.md#starting-a-run)).
A loaded plugin can add a row through its manifest.
