# Phase 1: keep agents off the paths the host dispatches

## Completion note

Done October 21, 2026, on branch `phase-1-plugin-handler-routes`.

`servePluginFetch` answers `404 not_found` to an internal caller on any path the host calls itself.
Devices pass. The set lives beside the route registry (`reserveHostDispatchedPath` and
`isHostDispatchedPath` in `packages/node-core/src/server/routes/registry.ts`). Every reservation goes
through the plugin's undo list, so a reload, a disable, or a contained failure replaces it along with
the plugin's other registrations.

Two feeders fill it:

- `reserveManifestRoutes` in `pluginHost/manifestWork.ts` reserves the manifest routes the host turns
  into function-backed registrations: agent tool handlers, context section reads, CLI command routes,
  schedule runs, task check and cleanup routes, hook handler routes, harness probes, and everything
  under a code host's `changeRequest.api`. The host calls it from `registerDeclarations`, at boot and
  at a reload's commit. `LoadedPluginBinding` gained `cliCommands` for it.
- The context seams that carry a path reserve it as they register: `dataSources.register` and
  `discover`, `runs.register`, and `nodeActions.register`. This also covers sources a loaded plugin
  registers from its own code, as Rollbar and Linear do, and built-ins that serve a source through
  `ctx.routes.fetch`, such as GitLab and Bitbucket.

Decisions and deviations:

- The recheck against every `dispatchPluginRoute` call found four callers the list above missed: node
  actions, run sources, the code host's change request API, and data source discoveries. All four
  are closed too.
- A task check doesn't put the task ID in its path. `runPluginTaskCheck` sends it as a `taskId` query
  parameter, so its path matches exactly and needs no pattern. The templated case is the code host's
  API, whose paths core builds as `{api}/{number}{view}`. That reservation covers the API path and
  everything under it.
- Paths compare after `decodeURI`, with repeated and trailing slashes dropped, so `/cli/%72aise` and
  `/cli/raise/` are refused too. Hono decodes the same way before a plugin's router matches.
- The rule covers fetch handlers only. Compiled routers keep their per-route gates, which
  `pluginMountCoverage.test.ts` checks.
- The scaffold's `/greeting`, and `examples/plugins/hello-pane/server/routes.js` with it, hold a
  task-scoped caller to its own task. The tutorial shows that file, and the scaffold test compares
  the two. The comments on acme-alerts' and the trigger template's raise routes say the Node refuses
  an agent there, and that the feed checks each event a device posts directly.
- Two site pages changed to match: the CLI command guide and the agent tools guide. The other pages
  `stale --touching` listed are marked current.

Checked on a standalone Node with acme-alerts loaded. A managed agent session's own task token got
`404` from `POST /v1/p/acme-alerts/cli/raise`, from the hosts source handler, and from
`/cli/%72aise`. The same token got `200` from its own task's tools. `acorn plugin acme-alerts raise`
stored its event, and no agent event reached the feed. With acme-agent's `add_note` raised to
`execute`, the agent got `404` both from the tool route and from the handler path, and no note was
written.

What later phases need to know:

- The Node service graph grew by 1,426 bytes, from 1,930,625 to 1,932,051, which is 151 bytes over
  this branch's 1,931,900-byte ceiling. All of it runs at boot or on every plugin request, so it
  can't move behind a dynamic import. `pnpm --filter @acorn/node build` fails its size check until
  the ceiling is raised, which is the coordinator's call.
- A path that a source names in an answer, such as a row action's `runNodeAction` path or a writable
  field's `path`, isn't known when the source registers, so it stays open to internal callers. Its
  handler has to check the caller. Phase 6 should record this as a known limit or design a fix.
- A new kind of manifest route the host dispatches needs a line in `reserveManifestRoutes`. A new
  registration that carries a path needs a `reserveDispatched` call at its context seam.

Date: October 21, 2026. Status: done. Severity: high.

A loaded plugin declares paths the host calls for it: an agent tool's handler, a context section's
read, a CLI command's route, a data source's handler, a schedule's run, a task check, and a hook
extension's route. The host calls each one in-process, after its own checks. The same paths are also
ordinary plugin URLs under `/v1/p/<plugin>/`, and nothing stops an agent from posting to them
directly with its task token. This phase closes that second door. Read
[the programme](./README.md) first.

## Starting point

Read at `32b2ab6c3`.

- `createApp` in `packages/node-core/src/server/index.ts` mounts `dispatchPluginFetch` over
  `/v1/p/:plugin` and `/v1/p/:plugin/*`, inside `requireUser`, so a task token reaches it.
  `servePluginFetch` in `packages/node-core/src/server/pluginHost/fetchRoute.ts` checks only that a
  principal exists, then hands the request to the plugin's fetch handler.
- The host's own calls don't come through there. `dispatchPluginRoute` in
  `packages/node-core/src/server/pluginHost/dispatch.ts` resolves the contribution and calls its fetch
  handler directly, with a principal the host built.
- Before an agent tool runs, `routes/plugins/agentTools.ts` checks `isToolWithinCeiling`, and the
  tool registry applies the owner's tier permissions, where `execute` is off by default
  ([plugin secrets and routes](../../security/plugin-secrets-and-routes.md#agent-tools)). Then
  `registerManifestRuntimeContributions` in `packages/node-core/src/server/pluginHost/runtimeContributions.ts`
  posts `{ arguments, origin }` to the handler with an internal task principal.
- Before a CLI command runs, `POST /v1/core/plugins/:id/cli/:name` in
  `packages/node-core/src/server/routes/plugins/plugins.ts` is device-only. It validates the input
  schema, the `nodeId`, the scope, and an `Idempotency-Key` for a write.
- A direct `POST /v1/p/<plugin>/<handler path>` with a task token skips every check above. The plugin
  sees `kind: 'internal'`, `scope: 'task'`, and its own `taskId`, the same shape the tool adapter
  sends, so it can't tell the two calls apart. The body's `origin` is whatever the agent wrote.
- A data source handler reached directly also skips `requireProviderAccess`, which refuses a task
  token on `/v1/core/data-sources`.
- Two docs promise the checks hold. [CLI commands](../../plugin-authoring/cli-commands.md) says "The
  Node has already checked the paired device, `nodeId`, and project existence before this handler
  runs." [Plugin secrets and routes](../../security/plugin-secrets-and-routes.md#agent-tools) says
  the `execute` tier is denied by default.
- `apps/node/test/integration/pluginMountCoverage.test.ts` can't see fetch handlers, which the
  October 11 review recorded as a known limit.
- The scaffold in `packages/create-acorn-plugin/index.mjs` writes a starter `GET /greeting` that loads
  any `taskId` from the query string, and a trigger template whose `/cli/raise` route appends feed
  events with no caller check. `examples/plugins/acme-alerts/src/index.ts` does the same, so a task
  token can raise an alert and wake every trigger on that feed.

## Changes

### Refuse an internal caller on a host-dispatched path

1. Keep one set of host-dispatched paths per plugin, beside the route registry in
   `packages/node-core/src/server/routes/registry.ts`. Each registration that leads to a
   `dispatchPluginRoute` call adds its path when it registers, and a reload or disable replaces the
   plugin's set. The callers are the tool and context registration in `runtimeContributions.ts`, the
   CLI commands read from the manifest, `scheduleRun.ts`, `taskCheckRun.ts`, `hookRun.ts`,
   `dataSources/dispatch.ts`, and the harness probes in `manifestAgents.ts`. Recheck this list against
   every `dispatchPluginRoute` call before you start.
2. A task check's path is a template filled with a task ID. Store it as a pattern that matches one
   path segment for the ID, and match the request path against it.
3. In `servePluginFetch`, answer `404 not_found` when the principal's kind is `internal` and the
   mount-relative path matches the plugin's set. Use 404, not 403, so the answer doesn't say which
   paths a plugin declares. Device callers pass through.

Why device callers keep access: the owner's own client and a plugin's frames call these paths over
the broker with the device's token, and a plugin may share a path between its frame and its tool.
Why only internal callers: a task token, the service principal, and a workflow step all reach
plugin code through `dispatchPluginRoute` when they're meant to. None needs the HTTP door.

Don't move the check into each plugin. A plugin can't tell the calls apart, which is the whole
problem.

### Correct the docs and the scaffold

- [CLI commands](../../plugin-authoring/cli-commands.md): say the host refuses agents on the command's
  route, and that a device can still call the route directly, without the schema check. A handler that
  matters must validate its own body.
- [Plugin secrets and routes](../../security/plugin-secrets-and-routes.md#routes-and-task-tokens): name
  the host-dispatched paths as closed to internal callers over HTTP, and keep the rest of the section.
- [Loaded tools](../../agent-tools/loaded-tools.md#loaded-manifest-carriers): one line that the handler
  path answers only the host.
- Scaffold and acme-alerts: refuse an internal caller on `/greeting`, or check `context.principal.taskId`
  against the requested task, as acme-browser does. Add a comment saying why.

## Tests

- A test beside `fetchRoute.test.ts`: a loaded plugin with an `execute` tool, a context section, a CLI
  command, a data source, and a task check. A task token posting to each declared path gets 404 and
  the handler never runs. A device token reaches each one. The host's own dispatch of each still
  succeeds.
- A reload that renames a tool's handler path closes the new path and opens the old one.
- In `pluginMountCoverage.test.ts`, a case that loads acme-alerts and drives a task token at
  `/v1/p/acme-alerts/cli/raise`.
- `examples/plugins/test/nodeExamples.test.ts` and the loaded plugin integration tests in `apps/node`
  still pass. A failure there means some internal caller used the HTTP door, so find it before you
  allow it.

## Acceptance

- In `pnpm dev:agent` with acme-alerts loaded, a task token from an agent's environment gets 404 from
  `POST /v1/p/acme-alerts/cli/raise`, and `acorn plugin acme-alerts raise` still stores an event.
- A loaded `execute` tool refused by the owner's tier stays refused both through the agent's MCP tool
  and by direct HTTP.
- The scaffold's generated plugin passes its own tests, and the docs above say what the code does.
