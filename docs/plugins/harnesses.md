# Harnesses

This page covers how the host delivers a harness, a managed agent declared as data, to the agents
plugin. It's part of the [plugin reference](../plugins.md). [Harnesses in the
manifest](../plugin-authoring/harnesses.md) is the authoring contract, and
[managed agents](../managed-agents/harnesses.md) owns the behavior.

## Harnesses

A plugin adds a managed agent, an Agent Client Protocol CLI that acorn drives with a full
transcript, permission prompts, and plans, by declaring `contributions.harnesses`. It needs no route,
no bundle, and no build step.

A compiled plugin registers a launch spec with the driver registry in `plugins/agents`. A loaded
plugin declares the harness in its manifest, and the host builds the registration through
`HostPluginContext` in `server/pluginHost/types.ts`. There's no `ctx.harnesses`. Schedules, data
sources, and task checks land in a node-core registry, but a harness lands in another plugin's,
through the `agents.harnessRegistry` capability. The contract is
`packages/node-core/src/server/pluginHost/harnesses.ts`, in node-core, because the host delivers a
harness and neither package may import the other.

The host does three things a plugin can't:

- **Mints the id** as `<pluginId>:<harnessId>`. The id is saved on every session row, so a manifest
  can't choose it.
- **Resolves an adapter entry** inside the contributing package, with the same confinement every
  manifest path gets. A descriptor whose entry escapes its package is dropped with a warning.
- **Turns a probe route into a call**, because only the host can dispatch a route with no client
  attached. The answer reaches `plugins/agents` as `unknown` and is parsed there.

The host resolves harnesses at delivery and never caches them. With agents disabled, a contributed
harness delivers nothing, and enabling agents delivers it again.

A harness package with no node half still gets a plugin row. The loader builds a plugin from the
manifest alone (`server/plugins/loader.ts`), with a no-op `init` and no storage, so it has a row in
**Settings > Plugins > Installed**, can be disabled, and rolls back like any plugin. A manifest-only
package can't take a compiled plugin's id.

## Trust

The harness's trust line sits under **Enforced**, and it's the only line there that names a program:
the host spawns exactly the declared command with the declared arguments. The grant key is the whole
spawn plus the environment passthrough, so swapping the binary, changing arguments, or widening a glob
reads as newly requested.

A descriptor's `oneShot` block gets a second line, keyed on its own arguments. It's the one argv a
manifest may assemble, with the model and the prompt in fixed positions
([model providers](../integrations/model-providers.md)). `headlessArgv` and `resumeArgv` stay
code-only, because a manifest that can say "if resuming, add these two arguments" is a template
language.

A plugin may declare at most four harnesses.
