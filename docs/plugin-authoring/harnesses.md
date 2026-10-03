# Harnesses

This page covers how to add a managed agent to acorn with a manifest and no code. It's part of
[the manifest](./the-manifest.md). [How the host delivers a harness](../plugins/harnesses.md) and
[managed-agent harnesses](../managed-agents/harnesses.md) cover the other side.

## Harnesses

A harness is a managed agent: acorn starts it, drives the session, and draws the transcript,
permission prompts, plans, and config options in the Agent pane. Every agent that speaks the
[Agent Client Protocol](https://agentclientprotocol.com) is one manifest away, because acorn owns
everything after the wire. That includes new-session defaults: the config options your harness
advertises are remembered and applied to the owner's next session
([new-session defaults](../managed-agents/defaults.md#new-session-defaults)).

This is the whole plugin that adds OpenCode:

```json
{
  "id": "opencode",
  "name": "OpenCode",
  "version": "1.0.0",
  "baseline": "acorn-1",
  "apiVersion": "3",
  "icon": { "d": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" },
  "contributions": {
    "harnesses": [
      {
        "id": "opencode",
        "label": "OpenCode",
        "spawn": { "command": "opencode", "args": ["acp"] },
        "envPassthrough": ["OPENCODE_*"],
        "quirks": { "manualCompaction": true },
        "terminal": { "command": "opencode" },
        "oneShot": { "args": ["run"], "modelFlag": "--model", "output": "text" }
      }
    ]
  }
}
```

It has no node entry, no client bundle, no build step, and no `exec` grant: you describe a spawn, and
the agents plugin owns the child process. Install it, approve the two lines the trust prompt shows, and
OpenCode appears beside Claude and Codex in the Agent pane, in task terminals, and in every Generate
control.

The runtime id is `opencode:opencode`, because the host prefixes your harness id with your plugin id.
The id is saved in session rows and workflow steps, so renaming it breaks your users' sessions.

| You declare | acorn does |
| --- | --- |
| `spawn` | Starts the agent, owns the child, and restarts and stops it in the documented order |
| `envPassthrough` | Builds the child environment through the broker. Credentials never pass through |
| `label`, `glyph` | Shows them on every surface: Agent Center rows, the pane header, usage, and notifications |
| `quirks` | Turns the matching control on or off, per harness |
| `terminal` | Registers the terminal profile: task terminals, handoff, and the input lease |
| `oneShot` | Lists your agent in every Generate control, and runs one contained turn when it's picked |
| `probes` | Fetches them and draws the answers |
| Nothing else | The ACP connection, the event ledger, transcript rendering, permissions, attachments, persistence, reconnect, and replay |

If you find yourself writing code to add a harness, either the agent doesn't speak ACP, and this
contract doesn't cover it, or the seam has a gap, which is a bug report.

## Spawn

`spawn` takes exactly one of two forms:

- **`command`** is an executable on `PATH`, with `args`, such as `opencode acp` or
  `gemini --experimental-acp`. The user installs the CLI, and your harness's diagnostics say when it's
  missing.
- **`entry`** is a package-relative JavaScript file, run with the Node service's own binary. Use it to
  ship an adapter for an agent that doesn't speak ACP. Add `requires: { command, env }`, and acorn
  finds that CLI on `PATH` and passes the child its absolute path under the variable you named.

An `entry` is your code in a child process. It's less privileged than a node half, but still code, and
the trust prompt says so.

The ACP project publishes each agent's launch arguments at
`cdn.agentclientprotocol.com/registry/v1/latest`. Copy yours from there. acorn never fetches it at
runtime, so launch arguments change only by plugin update, and the trust record sees the change.

## Quirks and probes

ACP doesn't carry everything every vendor can do, so you close the gap by declaration:

- `manualCompaction`: the agent has a compaction command, so the pane offers Compact.
- `sessionPersistence`: sessions outlive the agent process, so the terminal handoff exists. acorn
  picks a session back up after a restart without it, if your agent advertises `session/load` or
  `session/resume`.

Don't repeat anything the agent says through ACP capability negotiation. The driver reads that from
the wire.

`probes` are two optional GETs on your own node half, so they need a `node` entry:

- `probes.usage` answers `{ plan?, quotas: [{ id, label, percentRemaining, resetsAt?, resetText? }], account? }`.
  Use `session` as the id of the quota the compact indicator shows. acorn derives the health and the
  capture time. Without this route, your harness shows no usage section, which is right for most CLIs.
- `probes.auth` answers `{ authenticated: boolean | null, diagnostic? }` for the Agent Center's health
  row. `null` means "can't tell". An answer acorn can't read counts as `null`.

## One-shot text generation

`oneShot` describes how your CLI answers one prompt and exits. Declare it and your agent appears in
every Generate control, such as the commit message, the SQL draft, and the workflow generator, beside
the owner's API keys. It sits beside `terminal`, because some agents only hold conversations and some
only answer. DeepSeek's `dsh --profile headless "…"` answers and exits and has no interactive mode, so
it declares `oneShot` and no `terminal`.

- `command` is the executable, for a harness with no `terminal`. Leave it out when there's a
  `terminal`, because a harness runs one binary. Naming a second one is refused.
- `args`, required, is the subcommand and switches for one prompt in and one answer out, such as
  `["run"]`.
- `modelFlag` is the flag a model id goes behind, such as `--model`. Leave it out and your CLI uses
  its configured model.
- `output`, required, is `text` if the answer is on stdout, or `json-lines` for a newline-delimited
  stream with a `result` event, the shape `claude -p --output-format stream-json` writes. There's no
  default.

acorn builds the argv in fixed positions: your `args`, then `modelFlag` and the model when a caller
names one, then the prompt. A system prompt is put before the prompt with a blank line between. There
are no placeholders and no conditions. A CLI that wants the prompt in the middle needs a code-tier
profile.

Before you pick `output`, run your CLI with stdout on a pipe, because many CLIs print differently to a
terminal. `opencode run` sends its header, tool lines, and prompts to stderr and only the answer to
stdout, so `text` is right for it. `opencode run --format json` has no `result` event, so `json-lines`
would read the answer as missing.

A generate runs contained: in an empty temporary directory, with no acorn token and no MCP server, a
60-second limit, and no key acorn holds in the environment, so your CLI uses its own login. The trust
prompt names the invocation on its own line, such as "Runs `opencode run --model MODEL` to generate
text". Changing those arguments in a later version asks the owner again.

## What a data-only harness doesn't get

A data-only harness works in the Agent pane, the terminal, and the Generate lists. A workflow's agent
step can't name it, because conditional argv would need a template language. A workflow `decide` step
can, but it needs a JSON verdict, and a manifest can't ask your CLI for one, so a `text` harness fails
there. A harness that needs either needs first-party work, not a bigger manifest.
