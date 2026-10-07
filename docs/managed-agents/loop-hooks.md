# Harness bridges

A harness runs its own agent loop, so acorn can't intercept a tool call it never asks about. A
harness bridge closes that gap where the harness publishes hooks inside its loop. Acorn installs a
small program in the harness's own hooks, the program forwards each tool call to the Node, and the
Node runs two hook points and answers in the harness's words. This page covers the points, the
bridge, which harnesses have one, and what a bridge can't do.

`plugins/agents/src/contract/loopHook.ts` declares the points and the `agents.loopHook.v1` shapes.
`plugins/agents/src/server/sessions/loopHooks.ts` answers a call, and
`plugins/agents/src/server/drivers/claudeLoopHook.ts` holds Claude Code's spelling.

## The points

Agents declares two hook points beside `agents:before-permission`
([hooks](../plugins/hooks.md#hooks-that-exist)).

`agents:before-tool` runs before a bridged harness runs any tool. It allows `observe`, `veto`, and
`ask`, runs handlers in install order, and gives each one 5 seconds. A timeout or a throw is no
objection. Its payload reuses the permission hook's subject, so a policy can point one function at
both points:

| Field | Meaning |
| --- | --- |
| `sessionId`, `taskId`, `providerId`, `unattended`, `root` | As on `agents:before-permission`. |
| `toolCallId` | The harness's id for the call. Claude Code's `tool_use_id` is the same id its ACP adapter uses, so a handler recognizes the call when the permission hook fires for it afterward. |
| `toolName` | The harness's own tool name, such as `Bash` or `Write`. |
| `title` | The command, the first path, or the tool name. |
| `kind`, `command`, `paths` | The `AgentPermissionSubject` vocabulary ([permission policy](./permission-policy.md#the-payload)). |

`agents:after-tool` runs after a bridged harness ran a tool. It allows `observe` and `transform`. Its
payload is the same subject plus `succeeded` and `note`, which starts empty. A transform that sets
`note` hands the model that text beside the tool's result, inside the same turn. The Node trims the
note and caps it at 4,096 characters, and ignores any other field a transform changes. Claude Code
sends this event only for a call that finished, so `succeeded` is always `true` there.

## What each answer does

| Verdict | What the harness hears |
| --- | --- |
| No handler, no objection, a timeout, or a failure | No decision. The harness's own checks run as if no bridge existed. |
| A veto | A deny with "Blocked by `<plugin>`: `<reason>`". The model reads it in the same turn. |
| An ask | The call waits on an ordinary permission card that names the plugin and its reason. |
| An after-tool note | The note, as context beside the result. |

An ask raises a request in the session's transcript, titled with the call's `title` and detailed as
"`<plugin>` wants you to decide: `<reason>`", with **Allow** and **Reject**. The bridge call waits for
the person, up to 570 seconds:

- **Reject** denies the call: "The person refused this when `<plugin>` asked them: `<reason>`".
- **Allow** is no decision, so the harness's own permission flow still runs. In a session that asks
  before each command, the person then sees the harness's own card too.
- No answer in time expires the request and denies the call, saying nobody answered.

A veto later in the chain still refuses outright, and the first ask wins only when nothing vetoed.

The bridge never answers allow. Not after an approved ask, and not when every handler agrees. A
plugin can make a session stricter and never approve a tool on the person's behalf.

## The bridge program

The build emits `loop-hook.js` beside `mcp.js`, and the Node that runs `mcp.js` runs it
(`apps/node/src/entries/loop-hook.ts`, `packages/node-core/src/mcp/loopHook.ts`). The harness runs
`<node> loop-hook.js /v1/p/agents/loop-hook agents.loopHook.v1 <harness> <event>` with the hook input
on standard input. The program reads it, posts it to the route on the command line, and prints the
`output` the Node composed. Agents writes the route and the version into the command, so the program
names no plugin. It decides nothing. A stopped Node, an unreachable endpoint, an error reply, or input that isn't JSON prints
nothing and exits zero, which every bridged harness reads as no decision.

The program inherits the provider process's environment, so it holds the same task token, data root,
and certificate as acorn's MCP server ([MCP](../mcp.md#launch-environment)).

### The ingress

`POST /v1/p/agents/loop-hook` takes a body of up to 1 MiB:

```json
{ "version": "agents.loopHook.v1", "harness": "claude", "event": "PreToolUse", "input": { "tool_name": "Bash" } }
```

It answers `{ "version": "agents.loopHook.v1", "output": "<what the bridge prints>" }`. The token,
not the body, names the task and the session. Only a task token bound to a session gets an answer.
A device, a token with no session, another task's session, a body the route doesn't recognize, or a
session this Node doesn't have gets an empty `output`. A person-installed Claude Code mod can post
the same shape, but a session acorn didn't start has no task token, so admitting one needs its own
principal.

## Installation

At each start and resume, the lifecycle asks the hook registry which plugins handle each point
(`ctx.hooks.handlers`). A driver whose harness takes a bridge gets one only for a point with a
handler, so a session with no handler installs nothing and pays no process per tool call. A handler
registered while a session runs reaches it after the session's next resume.

### Claude Code

Acorn adds command hooks to the flag settings it already sends in `claudeCode.options.settings`, beside
`autoContinueAtUsageLimit` and the skill read rules. The adapter passes them to the Agent SDK, which
gives them to Claude Code as `--settings`. Each entry matches every tool (`*`) and has a 600-second
timeout. Nothing is written to the person's own settings files.

Claude Code runs every matching hook from every settings source at once, the person's own included,
and a deny from any of them refuses the call. On Claude Code 2.1.292, a deny from acorn's hook
refused `git status` that the person's own `PreToolUse` hook approved, with the session in
`bypassPermissions`.

On an Apple silicon Mac on October 7, 2026, one bridge call took a median of 57 ms against a running
Node, for a call the policy let through and for one it refused. About 28 ms of that is starting
Node, measured with no Node to reach.

### Codex

Codex has no bridge. Codex 0.159.2 runs a hook only after a person trusts its exact definition, and
the only trust a host could reach is out of bounds:

- A hook passed for one session, through `-c` or the `config` on `thread/start`, is listed by
  `hooks/list` with `source: "sessionFlags"`, `isManaged: false`, and `trustStatus: "untrusted"`.
- Trust is recorded as `hooks.state."<key>".trusted_hash` in the person's `~/.codex/config.toml`,
  through `config/batchWrite`. Writing it would change the person's own settings.
- Managed hooks come from system, MDM, cloud, or `requirements.toml` layers, which an administrator
  owns.
- `--dangerously-bypass-hook-trust`, or the `bypass_hook_trust` override, also skips trust for the
  person's own hooks. Acorn never passes it.

So Codex reports neither loop capability, and its tool calls reach `agents:before-permission` only.

### Other harnesses

DeepSeek and contributed ACP harnesses have no bridge and keep `agents:before-permission` only. An
`omp` extension could carry one, but no `omp` build was available to verify its `tool_call` API.

## Coverage

A driver reports `loop_before_tool` and `loop_after_tool` in its descriptor's capabilities only when
its harness takes a bridge and this Node has the bridge program. A standalone Node has none.

A plugin's page in **Settings > Plugins** has an **Agents it reaches** section for a plugin that
handles `agents:before-tool`, `agents:after-tool`, or `agents:before-permission`. Agents draws it
through core's `core:plugin-page` point, from `GET /v1/p/agents/loop-coverage/<pluginId>`. Each
installed harness reads **Every tool call**, **Only the tool calls it asks you about**, or **No tool
calls**, and adds **every tool result** when an after-tool handler reaches it.

## Relation to the permission hook and explanations

`agents:before-permission` stays. It covers harnesses without a bridge, and it still sees questions a
bridge doesn't, such as a Codex network grant. A handler on both points sees a call twice when the
bridge lets it through and the harness then asks. The two payloads carry the same `toolCallId`, so
the handler can answer the same way both times.

A bridge's deny reaches the model inside the turn, so a policy has no refusal to explain afterward.
The explanation note in [session messages](./session-messages.md#the-policy-plugins-explanations)
stays the fallback for a refusal on the permission hook.

## What it doesn't do

- **It doesn't return a result instead of running the tool.** The transcript would show a call that
  never ran.
- **It doesn't rewrite a tool's input.** Changing a command the person approved is a larger grant
  than a veto.
- **It doesn't rewrite a tool's output.** A note sits beside the result. It doesn't replace it.
- **It isn't containment.** A refused command can come back as a script the hook sees only as
  `bash script.sh`. [Security](../security.md) owns the boundaries that exist.

The policy package in `docs/future/pi/packages/permission-policy/` is the sample consumer. It
refuses on `agents:before-tool` with its permission rules, asks with its warning rules, and adds a
test-first note on `agents:after-tool`.
