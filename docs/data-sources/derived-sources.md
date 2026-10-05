# Derived sources

A derived source is a data source that declares other sources as named inputs. Acorn reads the
inputs on its behalf, with the accounts each query binds, and the plugin returns records in the
shape it describes. Read this page to build one, or to change how the host checks and reads its
inputs. It extends the [typed data sources](../data-sources.md) contract.

The code lives in `packages/node-core/src/server/dataSources/inputs.ts` (handles, revisions, and
completeness), `authority.ts` (binding checks), and `packages/node-core/src/server/plugins/inputGrants.ts`
(approval for loaded plugins).

## Declare inputs

Add `inputs` to the source's registration, in `contributions.dataSources` or through
`ctx.dataSources.register`:

```json
{
  "sourceId": "readiness", "name": "Release readiness", "singular": "Issue", "plural": "Issues",
  "identityScope": "Linear issue", "handler": "/v1/p/release-readiness/readiness",
  "inputs": {
    "issues": { "source": "linear:issues", "label": "Issues" },
    "pulls": { "source": "github:pull-requests", "label": "Pull requests", "optional": true }
  }
}
```

These rules apply to every declaration:

- An input name matches `^[a-z][a-zA-Z0-9]{0,31}$`. A source declares at most eight inputs.
- `source` is `<pluginId>:<sourceId>`, and it must name a statically registered source. A
  discovered source can't be an input.
- A source with `inputs` can't declare a `providerId`. It reaches accounts only through its inputs.
  Manifest validation and the registry both refuse the pair.

The catalog that `list` returns carries each source's `inputs`, so a client can draw an account
picker per input before anyone runs a query.

## Bind inputs on a query

A query binds each input in `scope.inputs`, by name, with the same `connectionId` and `parameters`
a direct call's scope uses. The input's read gets the outer scope's workspace and project. When an
input is itself a derived source, its binding carries an `inputs` map for that source in turn.
Stored plans without `inputs` stay valid.

The Node checks the bindings before it calls the plugin:

- A top-level `connectionId` on a derived source fails with `invalid-request`.
- A binding for a name the source didn't declare fails with `invalid-request`. A source without
  inputs accepts no bindings.
- Each binding gets the checks a direct call to its input would get: the connection belongs to the
  person, matches the input's provider, and isn't disabled or `needs-auth`.
- A missing binding for a required input, or a provider input bound without an account, fails
  `query`, `options`, `details`, and `actions` with `input-required`. `describe` needs no bindings.
- An input whose source isn't installed or whose account check fails gets `input-unavailable`.

Both input codes carry the input's name. The `/v1/core/data-sources` routes return it in the error
envelope's `details` as `{ input, reason? }`.

## Read through the host

A derived source's handler finds one handle per bound input on its request context:

```js
export async function fetchReadiness(request, context) {
  const issues = await context.inputs.issues.query({ sort: [{ pointer: '/updated', direction: 'desc' }] })
  // Build records from issues.records in the shape your description declares.
}
```

Each handle offers `describe()`, `identity()`, `query(query)`, and `options(request)`. Every call
runs a full source invocation for the input with the bound scope, so admission, description,
validation, and per-provider scheduling all apply as they do for a direct read. A `query` takes the
outer request's mode and evaluation time. An optional input that the query didn't bind has no
handle. There is no actions handle and no write path.

Input reads share the outer invocation's abort signal, so the panel's time budget covers the plugin
and its inputs together. The derived source's own `providers` runtime refuses every call, as it
does for any connectionless source.

A loaded plugin can't call `ctx.dataSources.invoke` on another plugin's source. The handle is its
only way to read one, so it reads only inside a request and only with accounts the person chose.

The host tracks the derived sources each read is nested inside. A read that would revisit one fails
with `invalid-request` and the reason "Inputs form a loop". A read that would nest a third derived
source fails with `invalid-request` too.

When an input read fails and the handler then fails, the caller sees the input's error, such as
`input-unavailable` for an input the grant doesn't cover, rather than `provider-failure`.

## Approve inputs for loaded plugins

A loaded plugin's handle refuses any input its grant doesn't cover, with `input-unavailable` and the
reason "Not approved". Compiled plugins need no grant, because their code ships with Acorn.

The Node stores grants in `input-grants.json` in the data root, written privately and atomically. A
grant records the plugin, each source's inputs by name with their `source` and `optional` flag, when
it was given, and by whom. The Node reads an unparseable file as no grants. It checks the grant at
every read, so a change takes effect without a restart.

A grant covers inputs one at a time. When an installed version changes its inputs, the plugin keeps
reading the inputs whose source and optional flag still match, and a new or changed input stays
refused until a grant covers it.

The person approves the list in the trust prompt, under **Reads your data**. The Node puts each
plugin's inputs on its roster row, worded from the input source's registration and its owner, with an
`approved` flag per input. The prompt appears for any row with an input the grant doesn't cover, even
for a plugin with no client half, and on an update it leads with only those inputs.
`/v1/core/plugins/:id/input-grant` holds the grant, behind the same device gate as the other plugin
routes:

- `GET` returns the declared inputs, the stored grant, and `usage`: the published panels that bind
  each input, with their account ids. It reads every published plan, so call it when someone asks.
- `POST` carries the exact list the person saw, keyed by source id, then input name, with `source`
  and `optional`. The Node answers 409 when that list doesn't match the installed version, so a
  dialog left open across an update can't approve something it never showed.
- `DELETE` revokes the grant. The plugin's panels stay, and their reads fail with
  `input-unavailable` until the person approves again.

Both writes broadcast `plugins:changed`. For the prompt, see
[plugin distribution](../plugins/distribution.md#approving-what-a-plugin-reads).

## Revisions and completeness

The host composes a derived source's `revision` from the plugin's own revision and each bound
input's description revision. A change upstream therefore invalidates cached descriptions and runs.
The plugin's pages still report its own revision, and the host checks them against that.

When an input read returns `incomplete`, the derived page is `incomplete` with the input's cause,
even if the plugin reports `complete` or `bounded`. The plugin's own `incomplete` wins over both.

A derived record that fails the description's schema is dropped rather than failing the page. The
page reports `incomplete` with cause `invalid-records` and a `count` of the dropped records. Sources
without inputs keep the whole-page `invalid-response` failure.

## Limits and known gaps

- GitHub's local-branches source still owns the `github` provider and reads `core:local-branches`
  through `ctx.dataSources.invoke`. Moving it onto inputs would break the account and parameters
  that stored panels carry at the top level of its scope.
- Core sources registered with a core handler can't declare inputs. Nothing needs one.

## Why

Panel steps are a closed set, so a team's own rules about data Acorn already reads belong in a
source. A source works in panels, workflows, and datasets without new step types, and it keeps
plugin code out of the Node's plan runner. Acorn reading the inputs, rather than the plugin, keeps
credentials in core and limits a loaded plugin to the sources the person approved.
