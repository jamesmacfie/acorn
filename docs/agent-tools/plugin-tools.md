# Plugin tools

Two core tools concern plugins: `plugin_authoring` teaches an agent to write one, and `plugin_request`
asks you to install, update, or remove one. Both are in `packages/node-core/src/server/agentTools/`.

## plugin_authoring

`pluginAuthoring.ts` is read-tier. It teaches an agent to write a plugin for the Node that will run
it. It takes no arguments and answers with a markdown guide and the same facts as structured data, so
a manifest can be checked without parsing prose.

Its rule is to never answer a plugin API question from memory, so everything is derived at call time.
The manifest keys, each contribution's cap, the two closed action verb sets, the frame targets, the
host slots, and the command categories come from `z.toJSONSchema(pluginManifestShape)`. The
`permissions.node` blocks come from the same schema, and the `core` facet list from
`server/plugins/permissions.ts`. The frame bridge's message kinds and methods are read off the wire
union in `@acorn/protocol/plugin/bridge.ts` through `satisfies`, so a new message kind is a compile
error. Only the process is hand-written. `pluginAuthoring.test.ts` derives every list again and
checks it reached the text.

It leaves two things out. The `@acorn/plugin-api` export list, because a hand-written plugin can't
import that package and a packaged Node has no copy of the surface snapshot. And the grantable
`permissions.api` scope names, because that allowlist is in the client, which the Node can't import.

It also answers through the `plugin-authoring` context section, with `defaultIncluded: false`, so a
task that isn't writing a plugin pays nothing. Tick **Plugin authoring** in the composer's context
picker, or call `task_context { include: 'plugin-authoring' }`. It isn't an `agentContexts`
descriptor, because that's a manifest key with a picker contract, and core would be pretending to be a
plugin. Neither path is a new route. A frame can reach the text only through
`GET /v1/core/tasks/:id/context` with `include=plugin-authoring`.

## plugin_request

`plugin_request` lets an agent ask you to install, update, or remove a plugin on this Node
(`pluginRequests.ts`). It's execute-tier and never shown to the renderer. It's the only tool whose
subject is which code the Node runs, so read it before adding anything like it.

It installs nothing. It writes a row in an in-memory queue, broadcasts a notice with no content, and
throws `needs-trust` (409) with a sentence telling the agent to call again with the same arguments to
collect your answer. You answer in the shell, and the device installs over the device-gated
`/v1/core/plugins/*` routes with its own principal. Prompt injection is a named threat, so an agent
never holds a credential that can install code. The module imports no installer, data root, or file
system, and a test pins its import list.

Only the first raise of a request rings the bell, 20 open requests is the cap, and collecting a
decision spends the row, so a second identical call is a new question. The agent's `reason` is capped
and drawn as text. [Plugins](../plugins.md) covers approval-mediated install.
