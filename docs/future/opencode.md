# OpenCode as a contributed harness

Date: October 9, 2026. Status: postponed on October 19, 2026. No OpenCode package exists, and
`opencode` isn't installed or signed in on the owner's machine. Facts about OpenCode come from
`references/opencode` at commit `388406238b`, version 1.18.35. The reference clone has since moved to
OpenCode 2.0.29 at commit `7b5f1bd9e1`, and OpenCode 2 changed its plugin and server contracts, so
recheck every fact here against the version you install.

This is the handoff for adding [OpenCode](https://opencode.ai) beside Claude Code and Codex. OpenCode
ships `opencode acp`, an Agent Client Protocol (ACP) server, so the work is one manifest, a live
conformance run, and two small doc fixes. If you find yourself writing driver code, stop and report
the gap against its owner instead.

Owning docs win where this disagrees with them. [Harness authoring](../plugin-authoring/harnesses.md#harnesses)
holds the manifest contract, and [managed-agents harnesses](../managed-agents/harnesses.md) holds the
driver. Neither is restated here.

## Outcome

An owner installs one folder, approves the trust prompt, and gets OpenCode in these places:

- The Agent pane, with streaming text, reasoning, tool calls, permission cards, and the model, effort,
  and mode pickers.
- Task terminals, through a terminal profile that runs `opencode`.
- Every Generate control, such as the commit message, through `opencode run`.
- Workflow agent steps and `agent_spawn` delegation, which run as managed sessions with no extra work.

## Out of scope

- Any change to `plugins/agents`. The generic ACP driver covers everything OpenCode sends.
- Usage and auth probes. OpenCode has no plan quota to report, so the package has no node half.
- Shipping the package with Acorn. Keep it a loaded package installed by folder. That keeps the seam
  honest and keeps a third-party CLI's launch arguments out of Acorn's release cycle.
- Workflow `decide` steps. They need a JSON verdict, and `opencode run` answers in text.

## What `opencode acp` does

Each row cites the OpenCode source under `references/opencode/packages/opencode/`.

| Behavior | What OpenCode does | What Acorn does with it |
| --- | --- | --- |
| Capabilities | `loadSession`, plus `resume`, `fork`, `close`, and `list`. Images and embedded context in prompts. MCP over HTTP and SSE (`src/acp/service.ts`). | The driver prefers `session/resume`. Fork, close, and list go unused. |
| Config options | **Model**, **Effort**, and **Session Mode**. Modes are OpenCode's agents, such as build and plan (`src/acp/config-option.ts`). | Draws them in the pane and remembers them as new-session defaults. |
| Permissions | Sends `session/request_permission` with options `once`, `always`, and `reject` (`src/acp/permission.ts`). | Draws a permission card. |
| File writes | Asks the client to write an approved edit only if the client offers `fs.writeTextFile` (`src/acp/permission.ts`). | Acorn declines `fs`, so OpenCode writes files with its own tools. |
| Compaction | Handles the `/compact` command by summarizing the session (`src/acp/service.ts`). | Acorn sends `/compact` when the harness declares `manualCompaction`. |
| Usage | Sends `usage_update` with context size and cost (`src/acp/usage.ts`). | Shows the context meter. |
| Unknown session | Answers `-32602` with "session not found" (`src/acp/error.ts`). | Starts a fresh session and warns the reader (`acpSession.ts`). |
| Questions | Turns its `question` tool off when the client is ACP, unless `OPENCODE_ENABLE_QUESTION_TOOL` is set (`src/tool/registry.ts`). The ACP code has no form support. | No question cards. Keep that variable from reaching the child, or the tool waits for an answer that never comes. |
| Subagents and plans | Sends no subagent metadata and no plan updates. | OpenCode's `task` tool shows as an ordinary tool call, and the subagent list stays empty. |
| Auth | Advertises one method, `opencode-login`, which tells the user to run `opencode auth login`. | Ignores auth methods. With no auth probe, sign-in reads as unknown, so **New** lists OpenCode even when it isn't signed in, and the first turn fails instead. An auth probe that answers `false` takes it out of **New**. |
| Local server | Starts an HTTP server on `127.0.0.1` with a random port, and talks to it itself (`src/cli/cmd/acp.ts`). It has no password unless `OPENCODE_SERVER_PASSWORD` is set. | One server per running session. See the risks below. |

## The manifest

This is the whole package. It differs from the example in the authoring doc in one place,
`envPassthrough`, for the reason in the next section.

```json
{
  "$schema": "https://acorn.sh/schemas/acorn-plugin.schema.json",
  "id": "opencode",
  "name": "OpenCode",
  "version": "0.1.0",
  "baseline": "acorn-1",
  "apiVersion": "3",
  "icon": { "d": "OPENCODE_24x24_PATH_D" },
  "contributions": {
    "harnesses": [
      {
        "id": "opencode",
        "label": "OpenCode",
        "spawn": { "command": "opencode", "args": ["acp"] },
        "envPassthrough": ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR"],
        "quirks": { "manualCompaction": true, "sessionPersistence": false },
        "terminal": { "command": "opencode" },
        "oneShot": { "args": ["run"], "modelFlag": "--model", "output": "text" }
      }
    ]
  }
}
```

The runtime ID is `opencode:opencode`. Session rows and workflow steps store it, so don't rename it
later. Copy `apiVersion` and `baseline` from the scaffold when you build, not from here.

### Pass two variables, not `OPENCODE_*`

The authoring doc's example passes `OPENCODE_*`. OpenCode reads several credentials under that prefix:
`OPENCODE_API_KEY`, `OPENCODE_AUTH_CONTENT`, `OPENCODE_CONSOLE_TOKEN`, and `OPENCODE_SERVER_PASSWORD`.
If the Node's environment held any of them, the glob would hand them to the child. Acorn's rule is that
passthrough carries tool configuration and never credentials. For the rule, see
[credential handling](../security/credentials.md).

OpenCode keeps its logins under `~/.local/share/opencode`, so it needs no key from the environment. The
two names in the manifest let an owner point OpenCode at a different config. The narrow list also keeps
`OPENCODE_ENABLE_QUESTION_TOOL` out, which matters for the reason in the table.

The spawn and the passthrough list together form the trust grant key. Widening the list later asks the
owner to approve again, which is the right cost for adding a variable.

### Start `sessionPersistence` at `false`

This quirk controls only **Continue in terminal**. Acorn picks a session back up after a restart
either way, because OpenCode advertises `session/resume`. Turn the quirk on in a later version, after a
manual check shows that the handoff reopens the same conversation in `opencode`.

### Keep the `oneShot` block

The source confirms what the authoring doc says. When stdout is a pipe, `opencode run` writes only the
answer text to stdout and everything else to stderr (`src/cli/cmd/run.ts`). So `text` is the right
`output`. `--model` takes `provider/model`, such as `anthropic/claude-sonnet-5-5`.

A generate can't approve anything. Without `--auto`, `opencode run` rejects every permission request,
so a tool call fails and the model answers from the prompt alone. Never add `--auto` or
`--dangerously-skip-permissions` to `args`.

### Use OpenCode's real mark

`icon` takes one SVG path `d` attribute drawn in a 24 by 24 box. Start from
`references/opencode/packages/ui/src/assets/favicon/favicon-v3.svg`, scale it to that box, and merge it
into one path if it has several.

## Build it

1. Install OpenCode, run `opencode auth login`, and confirm `opencode run "say hi"` answers.
2. Recheck each claim in [verify first](#verify-first) against the installed version.
3. Create the package as a folder outside the Acorn workspace, such as `~/Source/acorn-opencode`, with
   `acorn-plugin.json` and a short README. The README tells the owner to install `opencode` and sign in
   first.
4. Install it in a dev session. Run `pnpm dev:agent -- --session opencode`, then use
   **Settings > Plugins > Install…** with the folder, or post the folder path to
   `POST /v1/core/plugins/install`. For the route, see
   [installing a hand-written package](../plugin-authoring/installing-a-hand-written-package.md).
5. Restart the Node and approve the trust prompt. It shows two lines: the ACP spawn, and
   `opencode run --model MODEL` to generate text.
6. Run [the conformance checks](#conformance).
7. Fix the authoring doc example in `docs/plugin-authoring/harnesses.md` and the acceptance fixture in
   `apps/node/test/integration/harnessContribution.test.ts` to use the narrow `envPassthrough`. Both
   teach the `OPENCODE_*` glob.
8. Record the results as a dated entry in `docs/testing/agents-and-providers.md`, and mark manual
   check 62 done.

## Verify first

1. `opencode acp` is still the subcommand, and `initialize` still advertises `session/resume`.
2. The plugin API major is still 3 (`packages/protocol/src/plugin/apiVersion.ts`).
3. The harness descriptor still has every field the manifest uses
   (`packages/protocol/src/plugin/manifest/runtimeDescriptors.ts`).
4. `opencode run` still writes only the answer to stdout when stdout is a pipe. Run
   `opencode run "say hi" > out.txt` and read both streams.
5. OpenCode finds its login with only `HOME` and `PATH`. If the owner sets `XDG_DATA_HOME`, the base
   allowlist in `packages/node-core/src/server/agentProfiles/toolEnv.ts` doesn't pass it.

## Conformance

Run each of these in the Agent pane with a signed-in provider:

1. Prose, reasoning, and tool calls stream into the transcript, and the context meter fills.
2. A shell command and a file edit can each be allowed and rejected from the permission card.
3. An image attaches and the agent describes it.
4. Model, effort, and mode change, and the next session opens with the same choices.
5. **Compact** shortens the context, which is what `manualCompaction` claims.
6. A turn cancels mid-flight.
7. After a Node restart, the session reconnects and the agent remembers the conversation.
8. A Claude Code session delegates to `opencode:opencode` through `agent_spawn` and gets a report.
9. A workflow agent step on `opencode:opencode` publishes and finishes.
10. A task terminal opens OpenCode, and **Generate** writes a commit message with an OpenCode model.

Throughout, watch for anything on stdout that isn't JSON-RPC. OpenCode logs to stderr, but a plugin
loaded from the owner's OpenCode config might not.

## Risks and known gaps

- **Unauthenticated local server.** Each session's `opencode acp` listens on `127.0.0.1` with no
  password. Any process running as the same user could find the port and drive the agent. Running
  `opencode` in a terminal has the same exposure, so this is OpenCode's design. Don't work around it
  in Acorn. Mention it in the package README.
- **Config overrides.** OpenCode reads `opencode.json` from the project and from
  `~/.config/opencode`, so an owner's permission rules apply to Acorn sessions too. A rule of `allow`
  means no permission card ever appears. That's the owner's choice, but say it in the README.
- **No question cards and no subagent list.** See the table. Both need OpenCode to add ACP support.
- **Icon in the pane header.** A data-only package's `icon` doesn't reach the Agent pane header, which
  draws the label's first letter. The omp harness hit the same gap. It's generic, so leave it.

## Effort

About an hour for the package once OpenCode is installed and signed in. The conformance run takes
half a day, most of it the workflow, delegation, and restart checks.
