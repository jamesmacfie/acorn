# Custom agents

A custom agent is a saved start for a managed session: a harness, the options it starts on, text for
its system prompt, and a ceiling on acorn's own tools. It shows under **New** in the Agent pane, on
the empty pane's cards, and in the command palette. Use a triggered workflow for a job with several
steps. A custom agent is one session with a known setup.

## The record

The record is `CustomAgent` in `plugins/agents/src/shared/customAgents.ts`. Its options are the same
`optionId -> value` table a session default uses ([new-session defaults](./defaults.md)), so it names
no model field of its own. `maxToolRisk` is the highest-risk acorn tool the session may call, and like
every ceiling it only narrows ([agent tools](../agent-tools.md)).

Your agents are one `prefs` row per user, `agents:custom-agents:v1`. A plugin's agents are held in
memory while the plugin is enabled and aren't written anywhere. `GET /v1/p/agents/custom-agents`
returns yours in order, then each plugin's. `POST`, `PUT /:id`, and `DELETE /:id` write yours and are
device-only, because an agent decides a later session's system prompt. A plugin's agent refuses
writes, and Settings offers **Duplicate** for it.

## Start a session from an agent

`POST /sessions` takes `customAgentId`. `reserveSession` copies a `customAgent` snapshot onto the
session's `config` (ID, name, glyph, instructions), the agent's options as `requestedConfigOptions`,
and its ceiling as `toolCeiling`. A `customAgent` a caller put in `config` is dropped, and an agent on
another harness than the one named is refused. The options apply after your defaults, so an agent that
names only a model keeps your reasoning level. Applying them doesn't write your `last` values.

Drivers read the snapshot, not the live list. Editing an agent changes later sessions, and a resumed
session gets what it got at creation:

- Claude Code appends the instructions to its system prompt through `acpSessionMeta`, before the
  unattended turn-ending text when both apply.
- Codex sends them as `developerInstructions` on `thread/start` and `thread/resume`.
- Any other harness gets them as an `<acorn-context>` block with source `context.agent.instructions`
  before the first prompt of each new provider session, not on resume. A compaction can drop them,
  and the editor says so. A harness spec opts out with `systemPromptInstructions`.

The session header draws a chip with the agent's name from the snapshot. `agent_spawn` takes `agent`,
a name or ID, and looks it up by ID first, then by name ignoring case
([orchestration tools](../agent-tools/orchestration.md#managed-session-orchestration)).

## Settings

**Settings > Custom agents** lists your agents with **Edit** and **Duplicate**, and plugin agents
under **From plugins** with **Duplicate** only. The editor opens in the same pane with a back link. It
saves on its button, unlike the rest of Settings, because an agent needs a name and a harness to
exist, and it asks before you leave with changes. **Delete agent** sits in its danger zone and asks
first. Its model, effort, and mode pickers read the newest of the 50 latest sessions that advertised
options for that harness, so a harness you haven't run lately shows no pickers.

The icon control is the shared `IconPicker`. You can search Lucide icons, pick a random one, or reset
to the harness's icon, which removes the `glyph` override.

## From a plugin

A manifest declares up to eight agents in `contributions.customAgents`: `{ id, name, glyph?,
description?, harness, options?, instructions?, maxToolRisk? }`. They're data. An agent names no
program and can't bring a tool server, which is what `agentTools` is for.

Delivery follows the [harness seam](./harnesses.md#contributed-harnesses).
`packages/node-core/src/server/pluginHost/host.ts` hands each entry to the host-only `customAgents`
facet after every init, which forwards to the `agents.customAgentRegistry` capability. The host
qualifies the ID as `<pluginId>:<id>`, and qualifies `harness` when it names one of the manifest's
own harnesses. Another ID, such as `claude`, passes as written. A package that declares only agents or
harnesses still gets a plugin row, so you can turn it off. A compiled plugin calls the capability
itself.

The instructions are the grant. They go into the system prompt of every session started from the
agent, so the trust prompt shows them in full under **Declared**, and they're in the grant key, so a
version that changes one word asks again.

## Limits

A workflow step can't name a custom agent in place of `profile` and `config_options`.
