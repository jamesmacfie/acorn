# Custom agents

This page covers how a plugin ships a custom agent: a harness with the settings, instructions, and
tool access a session starts with. It's part of [the manifest](./the-manifest.md).

## Custom agents

The owner makes their own custom agents under **Settings > Custom agents**, and a plugin can ship
some. Each one is listed under **New** in the Agent pane and in the command palette, and another agent
can start it by name through `agent_spawn` ([custom agents](../managed-agents/custom-agents.md#custom-agents)).

```json
{
  "contributions": {
    "customAgents": [
      {
        "id": "reviewer",
        "name": "Bug reviewer",
        "harness": "codex",
        "options": { "reasoning": "high" },
        "instructions": "Review the change for correctness. Report each bug with its file and line.",
        "maxToolRisk": "read"
      }
    ]
  }
}
```

An entry is `{ id, name, glyph?, description?, harness, options?, instructions?, maxToolRisk? }`, and a
manifest may declare up to eight:

- The host mints the id as `<yourId>:<id>` and copies it onto every session started from the agent.
- `harness` is `claude`, `codex`, another plugin's `<pluginId>:<harnessId>`, or the bare id of a
  harness this manifest declares, which the host qualifies for you.
- `options` maps provider option ids to values, as the harness advertises them. A value the harness
  doesn't offer is dropped when the session starts, with a line in the transcript, and the session
  still runs.
- `maxToolRisk` is `read`, `write`, or `execute`. It narrows acorn's own tools and never widens them.

`instructions` go into the system prompt of every session started from the agent on Claude Code and
Codex, and in front of the first message on any other harness. That makes them the grant: the trust
prompt shows the full text, and a version that changes it asks again. An agent can't bring a tool
server, because a server is a program to run. Declare `agentTools` for that.

A package with only harnesses and custom agents needs no bundle. The owner sees it in **Settings >
Plugins > Installed** and can turn it off, which removes its agents from **New**. The owner can't edit
a plugin's agent, only duplicate it into one of their own.
