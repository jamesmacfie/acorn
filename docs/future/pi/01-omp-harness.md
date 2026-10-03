# 01. Run `omp` as a contributed harness

Status: proposed, 2026-10-02. Not started, and nothing here needs a change inside acorn.

Execution handoff, 2026-10-03: [phase 01](./phases/01-omp-harness.md). The manifest needs no core
change; the handoff verifies contributed-profile workflow admission rather than assuming it works.

## Why first

Every gap in this programme's [README](./README.md) comes from one fact: the agent loop belongs to
the harness, not to acorn. `omp` is a harness whose loop is extensible all the way down, and it
speaks the Agent Client Protocol (ACP) through `omp acp`. Acorn's tier 1 driver takes any ACP agent
from a manifest alone ([managed-agents.md § Harnesses](../../managed-agents/harnesses.md#harnesses)).

So the cheapest way to give acorn users context rewriting, stream rules, tool shadowing, and a
reviewer model is to let them run an agent that already has those, inside acorn's sessions,
transcript, permissions, worktrees, and delegation. If that works, acorn never has to build a loop to
offer deep-loop extensibility. If it fails, the failure says exactly which part of the generic driver
or the ACP contract is too narrow, which is worth knowing before building anything in files 02 to 06.

It is also the second harness contributed from outside the repository after the Kimi proposal
([kimi.md](../kimi.md)), and the first whose agent advertises fork, close, and session listing as well
as load and resume.

## What `omp acp` advertises

From `coding-agent/src/modes/acp/acp-agent.ts` in the `omp` repository, at `initialize`:

| Capability | Value | What acorn does with it |
| --- | --- | --- |
| `loadSession` | `true` | The driver picks a session back up with `session/load`, which replays history. |
| `sessionCapabilities.resume` | present | The driver prefers `session/resume` when both are present. Check which one it picks. |
| `sessionCapabilities.fork`, `close`, `list` | present | The generic driver does not use them. Fork stays a Codex-only native feature. |
| `mcpCapabilities` | `http`, `sse` | Stdio is the ACP baseline, so acorn's stdio MCP server and the owner's servers reach it through `mcpServers`. |
| `promptCapabilities` | `image`, `embeddedContext` | Attachments and `<acorn-context>` blocks both work. |
| `configOptions` | built per session | Model, thinking level, and mode appear in the pane and become new-session defaults with no work. |
| `authMethods` | present | Check how the generic driver treats them; `omp` keeps OAuth logins in its own store. |

Acorn's ACP client advertises `fs.readTextFile: false`, `fs.writeTextFile: false`, and
`terminal: false` (`plugins/agents/src/server/drivers/acpDriver.ts`), so `omp` runs its own native
`read`, `edit`, and `bash` rather than routing them through acorn. That is the right answer: those
tools are the reason to pick `omp`.

Acorn does advertise `elicitation.form`, and `omp` bridges its `ask` tool and its extensions' dialogs
to `unstable_createElicitation` when a client offers forms. So `omp`'s structured questions should
reach the person as acorn's form card. Confirm that in step 2.

## The manifest

```json
{
  "$schema": "https://acorn.sh/schemas/acorn-plugin.schema.json",
  "id": "omp",
  "name": "oh-my-pi",
  "version": "0.1.0",
  "baseline": "acorn-1",
  "apiVersion": "3",
  "icon": { "d": "PLACEHOLDER_24x24_PATH_D" },
  "contributions": {
    "harnesses": [
      {
        "id": "omp",
        "label": "oh-my-pi",
        "spawn": { "command": "omp", "args": ["acp"] },
        "envPassthrough": ["OMP_*"],
        "quirks": { "sessionPersistence": false },
        "terminal": { "command": "omp" }
      }
    ]
  }
}
```

The runtime id is `omp:omp`. It is persisted into session rows and workflow steps, so choose it once.
Copy `apiVersion` and `baseline` from the scaffold at the time of building rather than from here.

### Credentials stay in `omp`'s own store

`omp` signs in with `/login` and keeps OAuth tokens and keys under `~/.omp/agent`. Keep
`envPassthrough` to `OMP_*` and let the person run `omp` once in a terminal to sign in. Passing
`ANTHROPIC_API_KEY` or similar through would put a provider credential on a trust line for no gain,
and the whole spawn plus the passthrough list is the grant key, so widening it later asks again.

### Start `sessionPersistence` at `false`

The same reasoning as [kimi.md § Start `sessionPersistence` at `false`](../kimi.md#start-sessionpersistence-at-false).
The quirk only controls the terminal handoff. Turn it on after a manual check shows that
**Continue in terminal** reopens the same conversation in `omp`.

### Leave `oneShot` out

Acorn's contained generate turns tools off and runs in an empty directory. `omp -p` loads extensions
and tools by default, and this programme has not found the flag set that turns all of them off. Add
`oneShot` only after someone confirms the arguments that give a tool-free, extension-free, plain-text
answer. Until then `omp` works in the Agent pane and a task terminal.

### Approval mode

`omp acp` sends ACP `session/request_permission` for `bash`, deletes, moves, and edits that delete
or rename. Plain content edits do not ask. That matches how acorn already treats Claude in its
accept-edits mode. Do not pass `--yolo` or `--auto-approve` in `args`: that would skip acorn's
permission card entirely and the manifest would read as a quiet grant.

## What the owner gets inside `omp`

Everything `omp` loads from its own configuration runs inside an acorn session:

- Extensions from `~/.omp/agent/extensions` and the worktree's `.omp/extensions`.
- Rules, including TTSR rules, from `.omp`, `.cursor`, `.claude`, and the other formats `omp` reads.
- The advisor, when the person enables it. ACP and RPC hosts get protocol defaults for `advisor.*`,
  so it starts off unless a config overlay turns it on. A second harness entry with
  `"args": ["acp", "--config", "<path>"]` is the way to offer an advisor variant, and that path has
  to come from a `files` grant, not a literal.
- Memory, if the person configured an `omp` memory backend. This is separate from acorn's memory and
  the two do not share anything.

Acorn sees all of this only as ACP traffic. A TTSR interruption, for example, arrives as an aborted
turn followed by a new one, and the transcript draws it that way.

## Risks to check

- **Nested worktrees.** `omp`'s `task` tool can fan out into isolated workspaces using APFS clones or
  copies. Inside an acorn worktree that creates a second layer acorn does not track. Check where
  `omp` puts them and whether archiving the acorn task cleans them up. If not, document the setting
  that turns isolation off.
- **Subagent reporting.** `omp` subagents are not ACP sessions. Acorn's provider-native subagent
  roster ([managed-agents.md § Provider-native subagents](../../managed-agents.md#provider-native-subagents))
  shows what each harness reports, and `omp` may report nothing. That is acceptable; record it.
- **Runtime.** `omp` ships as a compiled binary through Homebrew and its install script. Confirm
  `omp acp` starts with no Bun on `PATH`, because the node service's login-shell `PATH` is what the
  spawn sees.
- **Stdout noise.** `omp` detours extension `console.log` away from stdout in ACP mode
  (`coding-agent/src/modes/acp/acp-mode.ts`). A user extension that writes to stdout some other way
  would corrupt the stream. The driver's error for a malformed frame should name the harness.

## Steps

1. Write the manifest in a standalone folder outside this repository, the way the machine-stats
   plugin is kept, and install it by folder path.
2. Run one interactive session end to end: prompt, an edit, a `bash` call that asks permission, an
   `ask` form, a model change from the config options, a restart and reload.
3. Run one delegated session and one workflow agent step on `omp:omp`.
4. Enable one TTSR rule and the advisor through an overlay and record how each looks in the transcript.
5. Write up what broke as issues against the generic driver, not as quirks in the manifest.
6. Add a numbered manual check to [agents and providers](../../testing/agents-and-providers.md) and
   a short `omp` example beside OpenCode in [the manifest § Harnesses](../../plugin-authoring/the-manifest.md#harnesses).

## What this does not give acorn

`omp`'s extensions only run in `omp` sessions. A Claude or Codex session gets none of them. Acorn's
own plugins still see an `omp` session from outside, exactly like any other harness. That is why
files 02 to 06 still matter.

## Verify before building

- The harness manifest fields in [the manifest § Harnesses](../../plugin-authoring/the-manifest.md#harnesses),
  especially whether `baseline` and `apiVersion` changed.
- How `acpDriver.ts` picks between `session/load` and `session/resume` when an agent offers both.
- How the generic driver handles `authMethods` in the `initialize` response.
- `omp acp --help` for the flags that set approval mode, config overlays, and tool isolation.
- Whether the install script's binary runs without Bun.
