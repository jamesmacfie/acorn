# Phase 8: source inputs and host-mediated reads

Status: proposed, October 5, 2026. Depends on nothing in the studio phases. It's the base for
phases 9 to 12. Read the [programme README](./README.md) first, especially
[derived sources](./README.md#derived-sources). The
[Derived Sources](https://claude.ai/artifact/W8vHKDojobsSD4GYi5xPxK) page shows the whole design,
and its "What stops this today" and "What a derived source may and may not do" sections are the
brief for this phase.

## Goal

Let a data source declare other sources as named inputs, and let Acorn read those inputs on the
source's behalf, with the accounts the person chose. A source built this way is a _derived source_.
After this phase, a compiled plugin can ship one, and a loaded plugin can ship one once the person
has approved its inputs. Phase 9 draws that approval. This phase stores and enforces it.

## Starting point

- A source registers with `dataSourceRegistrationSchema` in
  `packages/protocol/src/data/dataSourceContributions.ts`: `sourceId`, labels, `identityScope`,
  optional `providerId`, and a `handler` route. A loaded plugin declares it under
  `contributions.dataSources`. A compiled one calls `ctx.dataSources.register`.
- A source's scope is `dataSourceScopeSchema` in `packages/protocol/src/data/dataSources.ts`:
  `workspaceId`, `projectId`, one `connectionId`, and `parameters`. It's stored inside every
  inline query and saved query, so panel plans persist it.
- `invokeDataSource` in `packages/node-core/src/server/dataSources/runtime.ts` parses the request,
  finds the registered source, calls `authorizeDataSource`, describes the source, then runs the
  operation. Every invocation describes first. A query page must carry the description's
  `revision`, every record must validate against the description's schema, and one bad record
  fails the whole query with `invalid-response`.
- `authorizeDataSource` in `packages/node-core/src/server/dataSources/authority.ts` allows a
  `providerId` only when the same plugin owns it, requires a `connectionId` for a provider source,
  and refuses a `connectionId` on a source with no provider.
- `dispatchSource` in `dispatch.ts` posts the request to the plugin's handler route with the
  principal and a `PluginConnectionScope`. `buildPluginRequestContext` in
  `packages/node-core/src/server/pluginHost/requestContext.ts` uses that scope to give the handler a
  provider runtime confined to one connection.
- `ctx.dataSources.invoke` in `packages/node-core/src/server/pluginHost/context.ts` refuses a
  loaded plugin's call to another plugin's source: "Loaded code may only invoke its own sources."
  Compiled plugins may invoke any source. GitHub's branch source does
  (`plugins/github/src/server/data/branchSourceHandler.ts`), and so does Workflows.
- Node-side plugin state lives in small JSON files in the data root, such as
  `disabled-plugins.json` (`packages/node-core/src/server/plugins/disabled.ts`) and the
  pending-review markers (`pendingReview.ts`).

## Requirements

### Declaring inputs

1. Add an optional `inputs` map to `dataSourceRegistrationSchema`. Keys are input names matching
   `^[a-z][a-zA-Z0-9]{0,31}$`. Each value is `{ source: '<pluginId>:<sourceId>', label, optional? }`.
   At most eight inputs.
2. A source with `inputs` may not declare a `providerId`. It reads accounts only through its inputs.
   Manifest validation in `packages/node-core/src/server/plugins/manifestValidation/node.ts` refuses
   both together with "A source with inputs can't also own a provider."
3. An input must name a statically registered source. A discovered source can't be an input. See
   [refused](./refused.md#discovered-sources-as-inputs).
4. Mirror the type in `packages/plugin-types/src/contracts/data.ts` and update
   `tools/arch/publishedPluginSurface.snapshot.txt` in the same change.

### Binding inputs on a query

5. Add an optional `inputs` map to `dataSourceScopeSchema`: one binding per input name, each
   `{ connectionId?, parameters }`. It's the same shape as a scope's account and parameters, so
   reach and required parameters work the same way. It's additive, so stored plans stay valid.
6. In `authorizeDataSource`, for a source with inputs:
   - Refuse a top-level `connectionId` with `invalid-request`, as today for a connectionless source.
   - For each binding, look up the input's registered source and run the same checks a direct call
     would: the connection belongs to the principal, matches the input source's provider, and isn't
     disabled or `needs-auth`.
   - Refuse a binding for a name the source didn't declare.
   - A missing binding for a required input fails `query`, `options`, and `details` with
     `input-required`, naming the input. `describe` succeeds without bindings, because the launcher
     lists the source before anyone picks accounts.
7. Add `input-required` and `input-unavailable` to the `DataSourceError` codes in
   `packages/node-core/src/server/dataSources/validation.ts`. Each carries the input's name, so
   phase 10 can say "Pull requests needs a GitHub account."

### Reading through the host

8. Add an `inputs` member to the plugin request context, present only when the request is an
   operation on a derived source. `buildPluginRequestContext` builds it from the request's
   bindings, the same way it confines `providers` to one connection. Pass the bindings through
   `dispatchSource` beside `connectionScope`.
9. Each input handle offers `describe()`, `identity()`, `query(query)`, and `options(...)`. Each call
   runs `invokeDataSource` for the input's source with the bound scope merged in, so every existing
   check still applies. There's no `actions` handle and no write path.
10. Change the loaded-plugin rule in `context.ts` from "own sources only" to "own sources, or a
    declared input through the request's `inputs` handle". Raw `ctx.dataSources.invoke` on another
    plugin's source stays refused for loaded code, so a plugin can't read outside a request or with
    an account nobody chose.
11. Add the handle's calls to `packages/node-core/src/server/plugins/hostCallModes.ts` as `async`, so
    a loaded plugin's worker calls them over RPC.
12. Track the chain of sources in each invocation. Refuse a call that would revisit a source already
    in the chain (`invalid-request`, "Inputs form a loop") or go more than two derived sources deep.

### Approval for loaded plugins

13. Add an input grant store beside `disabled-plugins.json`, in a module named `inputGrants.ts` in
    `packages/node-core/src/server/plugins`. A grant records the plugin id, the exact input list it
    covers (source and optional flag per name), when it was given, and by whom. Write it with
    `writePrivateAtomic`, and read anything unparseable as "no grants", as `disabled.ts` does.
14. A loaded plugin's input handle refuses any input that isn't in its current grant, with
    `input-unavailable` and the reason "Not approved". Compiled plugins need no grant, because
    their code ships with Acorn.
15. When an installed version declares inputs that differ from the grant, the plugin keeps reading
    the inputs the grant still covers. A new or changed input stays refused until a new grant
    covers it. Phase 9 adds the approval route and dialog. Until it lands, a grant can be written
    only by development mode (phase 12) and by tests.

### Versions, budgets, and completeness

16. The host composes a derived source's `revision` from the plugin's own revision and each bound
    input's description revision, so a change upstream invalidates cached descriptions and runs.
    Apply it in `describe` and when checking each page's `revision`, so a plugin that only knows its
    own revision still passes the check.
17. Input reads use the outer invocation's signal and timeout, so the panel's time budget covers the
    plugin and its inputs together. They go through the same per-provider scheduling as direct reads.
18. When any input read returns `incomplete` completeness, mark the derived page `incomplete` too,
    with the input's cause, even if the plugin reports `complete`.
19. For a derived source only, a record that fails schema validation is dropped rather than failing
    the page. Count the dropped records and report them in the page as a new completeness cause,
    `invalid-records`, with the count. Keep today's whole-page failure for sources without inputs.

### First-party adoption

20. Move GitHub's branch source onto declared inputs (`local` → `core:local-branches`), so the
    first-party precedent uses the public contract. Keep its behaviour and its fields the same.

## Out of scope

- Any UI. Phases 9 and 10 draw approval and input choices.
- The SDK helpers. Phase 11 wraps the handle in `defineDerivedSource`.
- Write-back through inputs. See [refused](./refused.md#write-back-through-a-derived-source).

## Tests

- `authority.test.ts`: bindings for each input, a wrong provider, a disabled connection, an undeclared
  binding name, a top-level `connectionId` on a derived source, and `describe` with no bindings.
- `runtime.test.ts`: composed revisions, incomplete propagation, dropped invalid records with the
  count, the loop and depth refusals.
- `context.test.ts` or the pluginHost tests: a loaded plugin can read a granted input through the
  handle, can't read an ungranted one, and still can't call `invoke` on another plugin's source.
- `inputGrants.test.ts`: round trip, a corrupt file, and a grant that covers part of a changed list.
- The GitHub branch source's existing tests pass unchanged after requirement 20.

## Docs to update

- `docs/data-sources.md`: inputs, bindings, the derived source rules, and the new error codes.
- `docs/security/plugin-node-realm.md`: what a loaded plugin may read, and through what.
- `docs/plugin-authoring/permissions.md`: inputs as a grant, alongside the node permissions.
- `docs/plugin-authoring/the-manifest.md`: the `inputs` field.

## Verify before building

- How `dataSourceAvailableInScope` treats a source whose inputs come from a plugin that's disabled.
  The derived source should stay listed and fail its query with `input-unavailable`, not disappear.
- Whether `ProviderRequestScheduler` (`packages/node-core/src/server/integrations/budgetRuntime.ts`)
  already covers source reads made through `invokeDataSource`, or only resource reads.
- Every client that parses `DataSourceCompleteness`. Adding `invalid-records` to a strict enum can
  break an older client reading a newer Node's run. Check the desktop client and the terminal client.
- How `PluginRequestContext` crosses the loaded-plugin worker boundary today for `providers`, so
  `inputs` follows the same path.
