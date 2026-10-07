# Acorn links: refused alternatives

Date: October 7, 2026. Status: planned; implementation not started.
Read the [plan](./README.md) before you change these boundaries.

## Refused alternatives

| Alternative | Reason |
| --- | --- |
| A generic `acorn://command/<id>` that runs any palette command | Any web page can open a link. Commands delete, archive, push, and start agents. Actions are a short core-owned list, and each one confirms. |
| An agent prompt or workflow input in a link | A link would let a web page put words into an agent that has your credentials and your checkout. |
| The Node's label in the Node slot | Labels can be renamed, which breaks every link already shared. The ID doesn't change. |
| Pairing a Node from a link | Pairing grants full owner authority. It stays a deliberate step in **Settings → Nodes**. |
| One `acorn://` grammar for links and MCP resources | Links are absolute and reach the operating system. Resources are relative to one session's task and never leave the MCP server. One name for both would let an agent write `acorn://pr` and the operating system open it as a link. |
| A reserved `here` host for addresses relative to the session | It would give one grammar, but the app would need a meaning for a `here` link clicked outside an agent session. Nothing asks agents to write clickable links to their own context. |
| A separate `acorn-dev://` scheme for dev builds | Dev builds don't register a scheme at all. Agent-driven sessions feed links to the handler directly, which tests the same code. |
| The REST API with a device token for outside tools | The Node's port changes each launch, its certificate is self-signed, and a device token can do anything the owner can. A link holds no secret and lets the app act with its own credentials. |
| Router paths as the only public form | A plugin can rename a route. `open?url=` and the core forms stay stable while plugin paths change. |
| Merging notification targets and content targets first | It is worth doing, but the link scheme works without it, and tying the two together makes both slower to ship. |

## Deferred

- Status from Acorn shown somewhere else, such as on a GitHub page. That needs a read-only token
  scope and a fixed port, and belongs to the browser extension plan.
- `acorn open <link>` in the headless CLI. The operating system's `open` command does this once the
  scheme is registered.
- Actions beyond `new-task`. Each one needs its own case for why a link is the right way in.
