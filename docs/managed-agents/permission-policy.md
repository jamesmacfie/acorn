# Permission policy

A loaded plugin can refuse a harness permission request before acorn shows it to anyone. This page
covers the `agents:before-permission` hook, what a handler reads, what a refusal does, and what the
hook can't do. `plugins/agents/src/contract/permissionHook.ts` declares the hook and its payload, and
`plugins/agents/src/server/sessions/permissionPolicy.ts` runs it.

## Where it runs

Every harness stops and asks before it runs a tool its own settings don't already allow. Claude Code,
DeepSeek, and contributed ACP harnesses send `session/request_permission`. Codex sends
`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, or
`item/permissions/requestApproval`. Each driver parks the request, then hands the runtime a
driver-only `permission_request` event. The runtime runs the hook on it before the provider event
queue, so a slow handler holds only the harness that is already waiting. The session's other traffic
keeps streaming.

The hook allows `observe` and `veto`, runs handlers in install order, and gives each one 5 seconds.
A handler that times out or throws counts as no objection, and the request goes to the person as it
would with no hook. A stalled policy delays the card by up to 5 seconds and never approves anything.
This is the opposite of `core:before-tool-call`, which denies on timeout, because nobody stands behind
that gate ([plugin bundles](../security/plugin-bundles.md)).

## The payload

Every field is on every call, and a field the harness didn't send is empty. Nothing is rebuilt from
display text.

| Field | Meaning |
| --- | --- |
| `sessionId`, `taskId` | Where the request came from. |
| `requestId` | The parked request's id, scoped to the session. `agents.requests` reports the same id. |
| `providerId` | The harness. |
| `unattended` | `true` for `workflow` and `delegated` sessions. |
| `title` | The harness's own summary, as the card shows it. |
| `root` | The task's worktree root, or `''` when it couldn't be read. |
| `toolCallId` | The harness's id for the tool call, or `''`. |
| `kind` | `command`, `edit`, `read`, `fetch`, `permissions`, or `other`. |
| `command` | The command line when the harness sent one as a string, otherwise `''`. |
| `paths` | The paths the call touches when the harness named them, otherwise `[]`. |

`toolCallId`, `kind`, `command`, and `paths` are the public `AgentPermissionSubject` type. The
runtime caps the command at 16 KiB and the paths at 100 entries of 4 KiB each. A plugin outside this
repository imports `AgentBeforePermissionPayload` from `acorn-plugin-types` and casts its handler's
payload to it.

How each harness fills them:

- **ACP.** `kind` maps from the tool call's own kind: `execute` is `command`, `edit`, `delete`, and
  `move` are `edit`, `read` and `search` are `read`, and `fetch` is `fetch`. `paths` comes from
  `locations`. `command` is `rawInput.command` when it's a string, which holds for Claude Code's Bash
  tool. A permission request is an update to a tool call the agent may have announced earlier, so the
  driver merges the two by `toolCallId`. DeepSeek's request names only the call, and its `bash`
  command arrives that way. DeepSeek reports every tool as kind `other` and names no locations, so a
  DeepSeek edit has no paths.
- **Codex.** A command approval gives `command` and puts its working directory in `paths`. A
  file-change approval gives `edit`, with `grantRoot` as its one path when Codex sent one. A
  permissions approval gives `permissions`.

The subject stays in the driver's event. The event materializer keeps only the request, so the
command and paths never reach the wire, SQLite, or telemetry through this hook.

## What a veto does

1. The runtime answers the parked request with the first option of kind `reject_once`. For Codex
   that's `decline`, which refuses the call without ending the turn. A request with no such option is
   cancelled. A veto never picks `reject_always` or any approval, so no plugin writes a lasting rule
   into a harness's own settings.
2. The runtime records the request with `blocked: { by, reason }`. The host stamps `by` from the
   handler's registration and caps `reason` at 200 characters. The row is written `resolved` in the
   same transaction, so it never reads as pending: no notification, no attention badge, no webhook,
   and no wake for a delegated child's parent.
3. Both clients keep the refused request in the transcript and say who refused it and why. An older
   client draws it as an ordinary resolved request.

The reply happens before the record, with nothing awaited between them, so whatever the provider does
with the refusal lands after the request it answers. The turn recorded on the row is the one that
asked, even when that turn ends while the hook waits.

A veto that can't be delivered isn't recorded as one. If the harness withdrew the request during the
wait, or the reply fails, the transcript gets a warning instead, and no request row is written. A
request withdrawn while the hook allowed it is dropped the same way, because nobody saw it. A
generation that was stopped or replaced during the wait records nothing at all.

## Write a handler

A loaded package adds a route-backed veto handler in its manifest:

```json
{ "id": "rules", "point": "agents:before-permission", "mode": "veto",
  "label": "run a tool the agent asks permission for",
  "route": "/v1/p/my-policy/before-permission" }
```

The host posts the payload to the route and reads `{ ok: true }` or `{ ok: false, reason }` back. The
person sees the grant as "Stop agents from doing “run a tool the agent asks permission for”", marked
high, on the plugin's **Permissions** tab in **Settings > Plugins**. The sentence quotes the
extension's own `label`, so reuse the point's label to keep it readable. A package with no client
bundle never reaches the device trust prompt, so that tab is where the grant shows. Use `observe` to
watch requests without the power to stop them.

## Confirm a refusal

`agents.requests` adds `blocked: { by, reason }` to a resolved row a policy refused. The rest of the
resolution stays private. A consumer that wants to act on its own refusal, for example to explain it
to the agent, should wait for the resolved `plugin:agents:request-changed` event and read this
summary. A handler's own verdict isn't proof: a verdict that arrives after the timeout is ignored.
The explanation itself is a note through `agents:session-messenger`, a separate grant
([session messages](./session-messages.md#the-policy-plugins-explanations)).

## What it doesn't do

- **It sees only what the harness asks about.** A session in a bypass mode, a tool the harness's own
  settings already allow, or an earlier "allow for session" never reaches acorn. Nor does a request
  the harness answers itself: with `approvals_reviewer = "auto_review"` in `~/.codex/config.toml`,
  Codex's own reviewer approves and the transcript shows only "Automatic approval review approved".
  On a harness with a bridge, `agents:before-tool` sees every call and takes the same subject
  ([harness bridges](./loop-hooks.md)).
- **It isn't containment.** A refused `rm -rf` can come back as a script the harness doesn't ask
  about. [Security](../security.md) owns the boundaries that exist.
- **It can't change the command or the model's view.** The harness runs its own command, and its
  reply to a refusal has no room for a reason. The model reads a plain rejection.
- **It isn't a policy engine.** Rules live in the handler plugin's code. Acorn adds no rule language.

A sample consumer with two rules, no force-push and no deletion outside the task root, is the
`acorn-permission-policy` plugin, kept in its own repository. It can also explain each refusal to the agent, off by
default.
