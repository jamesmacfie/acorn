# Authoring a harness plugin

Status: proposal, 2026-08-22. Nothing here exists yet — this file is the target authoring contract,
written first so the seam gets built to fit it rather than documented after the fact. It is styled
after [plugin-authoring.md](../../plugin-authoring.md), which owns the general no-build-step contract
this extends. The acceptance test for the whole folder lives at the bottom of this file.

## The whole plugin

This is a complete acorn plugin that adds OpenCode as a managed harness. It is one manifest and one
icon path. There is no node bundle, no client bundle, no build step, and no `exec` grant — the
plugin never spawns anything; it describes a spawn, and plugins/agents owns the child.

```json
{
  "id": "opencode",
  "name": "OpenCode",
  "version": "0.1.0",
  "apiVersion": "2",
  "icon": { "d": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" },
  "contributions": {
    "harnesses": [
      {
        "id": "opencode",
        "label": "OpenCode",
        "spawn": { "command": "opencode", "args": ["acp"] },
        "envPassthrough": ["OPENCODE_*"],
        "quirks": { "manualCompaction": true },
        "terminal": { "command": "opencode" }
      }
    ]
  }
}
```

Install it like any other loaded plugin (plugins.md § Approval-mediated install), and the trust
prompt says the one thing that matters under **Enforced**: this plugin asks acorn to run `opencode`.
Approve it, and OpenCode appears beside Claude and Codex in the Agent Center and the task Agent
pane, with the full transcript, permission requests, plans, and config options — because all of that
is drawn from the normalized events the shared driver already produces.

The runtime id of this harness is `opencode:opencode` — the host prefixes your harness id with your
plugin id, the same minting rule extension points use, so no manifest can claim a name in someone
else's space. The id is persisted into session rows and workflow steps; renaming it is a
compatibility break for your users, not a label edit (README.md § The id constraint).

## What you declare, and what acorn does

| You declare | acorn does |
| --- | --- |
| `spawn` — how to start the agent process | Spawns it, owns the child, restarts and shuts it down in the documented order (managed-agents.md § Operations and failure) |
| `envPassthrough` — config vars by glob | Builds the child env through the broker-env contract; credentials never pass through (security.md § Credential handling) |
| `label`, `icon` | Every surface: Agent Center rows, the pane header, usage sections, notifications |
| `quirks` — what the protocol cannot ask | Enables or hides the matching affordances per harness |
| `terminal` — the interactive TUI profile | Registers the terminal profile: task terminals, handoff, the input-controller lease |
| nothing else | The ACP connection, the normalizer, the durable event ledger, transcript rendering, permission plumbing, attachments, session persistence, reconnect, replay |

You never write a driver, a normalizer, or a parser. If you are writing code to add a harness,
either the harness is not an ACP agent — in which case this contract does not cover it — or the seam
has a gap, which is a bug report.

## Where the launch spec comes from

The ACP project publishes a registry (`cdn.agentclientprotocol.com/registry/v1/latest`) listing each
agent's platform distributions and ACP launch arguments. Copy your agent's command and args from
there. acorn never fetches the registry at runtime — the manifest is the pinned truth, and an update
to your plugin is how launch args change, so the trust record can see it.

## The two spawn forms

`spawn` takes exactly one of:

- **`command`** — an executable resolved on `PATH`, with `args`. The common case: `opencode acp`,
  `gemini --experimental-acp`, `grok`. The user installs the CLI themselves; your descriptor's
  diagnostics say so when it is missing.
- **`entry`** — a package-relative JS file, run with the node service's own binary
  (`process.execPath` under `ELECTRON_RUN_AS_NODE=1`). This is how you ship an adapter for an agent
  that does not speak ACP natively: your package carries the adapter, the same way acorn's own
  Claude harness runs the packaged `claude-agent-acp` adapter. The entry is confined to your
  installed package directory at parse time, like every other manifest path.

An `entry` is plugin-shipped code running in a child process — less privileged than a node bundle
(it is not in the node's process), but still code, and the trust prompt says so.

## Declared quirks

ACP deliberately does not carry everything every vendor can do. The gap is closed per harness by
declaration, never by an id list inside acorn — bb's `supportsManualCompaction` is the model: "the
agent definition declares it: OpenCode implements /compact, Cursor does not."

The starting vocabulary:

- `manualCompaction` — the agent accepts an explicit compaction request.
- `sessionPersistence` — sessions survive the agent process and can be reloaded (`loadSession`);
  absent, acorn treats every start as fresh and says so in the pane.

The growth rule is the capability rule: a quirk is added to the vocabulary when a second harness
needs it, and each addition names the affordance it gates. What is not added: anything the agent can
already say through `initialize` capability negotiation — the driver reads those from the wire, and
a manifest restating them would drift.

## Optional code extras

Three things genuinely resist being data. Each is optional, each is a route on your own node half
(which means adding a `node` entry to the manifest), and each is named by the descriptor so the host
does the fetching — the same async-messages shape every other descriptor contribution uses:

- **`probes.usage`** — GET, answering the usage snapshot shape, for plan-usage display in the Agent
  pane. Without it your harness simply shows no usage section.
- **`probes.auth`** — GET, answering authenticated/unauthenticated with a diagnostic string, for the
  Agent Center's provider-health row. Without it the row shows installed-or-not only.
- **`enrich`** — deferred from v1, recorded here so the shape is agreed: a hook that promotes
  vendor-specific `_meta` fields from raw ACP updates into first-class normalized fields (emdash's
  precedent, with `_meta.claudeCode.parentToolUseId` as the motivating case). Until it exists,
  vendor extras beyond baseline ACP are dropped, not mangled.

Routes are confined to `/v2/p/<your-id>/` at parse time like every descriptor route.

## What a data-only harness does not get

Headless and workflow invocation — `headlessArgv`, `resumeArgv`, `aiArgv`, and the stream-JSON
parser on `AgentProfileContribution` — have no manifest form, deliberately. Turning conditional argv
assembly into manifest data means inventing an argv template language, and that is the kind of
flexibility this design refuses in favour of a contract a person can hold in their head. A data-only
harness works in the Agent pane and the terminal; workflow steps cannot name it. If a harness needs
headless support, that is the signal it wants first-party investment, not a bigger manifest.

## The acceptance test

This contract is done when someone outside the repo writes the opencode plugin from this file alone,
without asking a question. Every friction point that surfaces in that attempt is a docs bug or a
seam bug to fix before the seam is called finished — the test is phase 4 of [host.md](./host.md),
and it gates the phase, not the other way around.
