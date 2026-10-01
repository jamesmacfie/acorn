# What this programme refuses

Status: proposed, 2026-10-02. Each entry says what `omp` does, why acorn does not take it, and what
would make it worth revisiting.

## Plugins in-process with no isolation

`omp` imports extensions into its own process, runs them with full file system and network access, and
answers `ctx.isProjectTrusted()` with `true` every time. That is a reasonable choice for a command-line
tool one person runs over code they chose.

Acorn's plugins come from strangers and run on a node that may serve several devices. The worker
realm, the manifest grants, and the trust prompt exist so a person can read what a plugin does before
it runs ([extensibility.md](../../extensibility.md)). Nothing in this programme widens that.

Revisit: never for loaded plugins. A person who wants `omp`'s model runs `omp` as a harness
([01](./01-omp-harness.md)), where its extensions run in `omp`'s process under `omp`'s rules.

## Wrapping any method without an invitation

`omp` extensions can intercept any event, replace any built-in tool, and register under any name.
Acorn refused this model when it compared itself with Claude Code's function hooks
([mods.md § Refused](../mods.md#refused)). The `omp` comparison adds no new argument for it.

Revisit: when a real need cannot be expressed as an owner-declared point, widen the point's
vocabulary instead.

## Hooks on the token stream

`omp`'s stream rules stop the model mid-reply and retry. From outside the harness, acorn can only change
what the person sees, never what the model wrote, so a stream hook would make the transcript disagree
with the provider's record of the turn.

Revisit: if acorn ever owns a loop. Until then, people who want stream rules use `omp` as a harness.

## Building acorn's own agent loop now

Owning a loop is the only way to offer context rewriting, tool shadowing, and stream rules for every
session. It is also a second agent product to maintain against every provider's quirks, which is the
work `omp` documents in a 338 KB provider-quirks file.

Revisit: after [01](./01-omp-harness.md). If `omp` as a harness covers what people ask for, the answer
stays no. If the generic ACP driver turns out to be the limit, fix the driver first.

## Mid-turn steering

`omp` can add a message to a turn while it runs. Neither ACP nor the Codex app-server has a call for
that, and cancelling and restarting a turn to fake it loses the work in flight. [03](./03-session-messages.md)
queues behind the running turn instead.

Revisit: when a harness protocol gains a steer call. Add it as a second delivery mode, per driver.

## Model choice by family

`omp`'s `ctx.models.family` lets an extension pick a model from a different family from the session's.
[04](./04-unattended-model-calls.md) makes the owner pick a plugin's model in settings instead, because
a plugin choosing what to spend is the decision the `models` grant deliberately leaves to the person.

Revisit: if owners ask for "always a different family" often enough that picking by hand is a chore.

## A provider registration API for loaded plugins beyond what ships

`omp` lets an extension register a full model provider with streaming and usage reporting. Acorn's
loaded plugins can already register a model adapter through `ctx.providers.model` for a connection
provider they own ([integrations.md § Model providers](../../integrations.md#model-providers)). Agent
sessions spend the harness's own login, not acorn's keys, so a provider registered in acorn would not
reach Claude or Codex sessions anyway.

Revisit: if acorn owns a loop.

## Reading other tools' configuration on startup

`omp` reads rules, skills, and MCP servers from `.claude`, `.cursor`, `.codex`, `.windsurf`, and five
other formats. Acorn starts those tools rather than replacing them, so each harness already reads its
own files.

Revisit: if [06](./06-agent-content.md)'s Claude Code plugin importer ships and people want the same
for Cursor rules in Codex sessions.

## A marketplace in this programme

`omp` installs plugins from Claude Code-compatible marketplace catalogs. Acorn's discovery waits on
package signing, and [ecosystem](../ecosystem/README.md) owns that order. File 06 names the importer as
a later step and leaves catalogs to ecosystem.
