# What acorn takes from Claude Mods

Proposal, 2026-09-29. Not started.

Implementation handoffs, 2026-10-03: [Pi phase 02](./pi/phases/02-permission-veto.md) delivers this
hook and its policy consumer; [Pi phase 03](./pi/phases/03-session-messages.md) adds optional
explanations through a separate messaging grant. Use the [phase plan](./pi/phases/README.md) for
execution order and acceptance. This file owns the base hook design and comparison.

Claude Code is adding *function hooks*, marketed as Claude Mods: a plugin ships a TypeScript module
that wraps Claude Code's own methods like Express middleware. This file records how that model
compares with acorn's, which parts acorn already has, and the one piece worth building: a hook on the
permission requests every harness sends acorn. Paths are hints; check them before building.

Sources: the proposal and its thread,
[anthropics/claude-code#91870](https://github.com/anthropics/claude-code/issues/91870), where the
author's replies settle most design questions; the architecture paper linked from it, "Function Hooks:
Core Architecture"; and the built-in mods under `mods/` in that repository (`diff`, `agents-md`,
`sec-default`, `telemetry`).

## How Mods works

A mod registers handlers of the form `($, e, next)` on named events. `$` is the plugin's only access
to the world. It runs in a Bun worker with no file system or network of its own, so reading a file is
`$.fs.read`, and every method on `$` is itself an event other plugins can wrap. A handler can act
before, after, or instead of everything beneath it, or change the input on the way down. Registration
order decides who wraps whom, and an organization sets that order through five fixed tiers:
org-first, user, org-last, built-in, and core. Drawing works the same way. A handler wraps a
component the screen declares hookable, such as the tool-call card, and returns a tree of that
screen's own elements, which the terminal and the desktop each draw natively.

## What acorn already has

Most of the Mods feature list has an acorn equivalent, built on the owner-declared model:

| Mods | acorn | Owning doc |
| --- | --- | --- |
| `ui.render` of a declared component | Remote trees drawn from the closed kit; `agents:tool-card` replaces the card for a named tool | [cooperative-extension-points.md](../plugins/cooperative-extension-points.md) |
| `AbovePrompt`, status line | `agents:composer-actions`, `agents:session-header` | [cooperative-extension-points.md](../plugins/cooperative-extension-points.md) |
| `prompt.submit` | `agents:before-send`, with observe, transform, and veto | [node-side-extension-points.md](../plugins/node-side-extension-points.md#hooks) |
| `prompt.context`, `prompt.section` | Context sections and `core:before-snapshot` | [agent-tools.md](../agent-tools.md#context-sections) |
| `tool.register` | Agent tool contributions | [agent-tools.md](../agent-tools.md) |
| `tool.check` on acorn's own tools | `core:before-tool-call` | [node-side-extension-points.md](../plugins/node-side-extension-points.md#hooks) |
| `$` as the only door, in a worker | The permission-scoped worker and its owner-bound context | [extensibility.md](../extensibility.md#the-node-half-is-isolated) |
| Adding a noun to `$` | Capabilities with a `contract/` folder | [plugin-map.md](../plugin-map.md#talking-to-another-plugin) |
| `turn.complete`, `agent.spawn` | Agents lifecycle events and managed delegation | [managed-agents.md](../managed-agents.md) |
| `sec-default`, org tiers | The managed policy layer, designed and not built | [sandbox/enterprise-policy.md](./sandbox/enterprise-policy.md) |

Because these live in acorn rather than in the agent, each works the same for Claude, Codex, and
DeepSeek.

## What acorn keeps doing differently

Mods lets any plugin wrap any method, and the admin's plugin order is the safety model. acorn lets a
plugin change another plugin's behavior only where the owner opened a point
([node-side-extension-points.md § There is no uncooperative extension](../plugins/node-side-extension-points.md#there-is-no-uncooperative-extension)).
That stays. The Mods thread supports keeping it. Commenters found that when two handlers object, the
chain returns one objection and drops the other, which acorn's `collect` flag already solves. They
spent days on whether a handler that throws lets the action through or stops it, which an acorn owner
settles up front with `onTimeout`. Mods is built for a company with an admin. acorn is built for a
person installing a stranger's plugin, and that person needs to read what a plugin can do before it
runs.

## The gap: harness permission requests

Every harness asks acorn before it runs a risky tool, and nothing but the person can answer.

1. Claude and DeepSeek send ACP's `session/request_permission`. `clientFor` in
   `plugins/agents/src/server/drivers/acpDriver.ts` parks the request and announces it through
   `normalizeAcpPermission` in `acpNormalizer.ts`.
2. Codex sends `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, and
   `item/permissions/requestApproval`. `onServerRequest` in `codexDriver.ts` parks the request and
   announces it through `normalizeCodexServerRequest` in `codexNormalizer.ts`.
3. Both become the same `request` event of kind `permission` and reach `onProviderEvent` in
   `plugins/agents/src/server/sessions/runtimeEngine.ts`.
4. `applyEventProjection` in `sessionRepository.ts` writes the row as `pending`, and
   `announceRequest` in `lifecycle.ts` publishes `plugin:agents:request-changed`. That publish drives
   the card, the notification, and a delegated child's wake on its parent.
5. The person picks an option, and `resolveRequest` in `runtime.ts` sends it back through the driver.

`core:before-tool-call` doesn't cover this. It guards only the tools acorn contributes, on the agent
tools route (`packages/node-core/src/server/routes/plugins/agentTools.ts`), and withholds their
arguments on purpose.

Because every driver already parks the request before announcing it, the runtime can answer the
request right there. A hook at that one point covers every harness.

## The design: `agents:before-permission`

The agents plugin owns the point, because it owns sessions and requests. It's declared beside
`before-send` in `plugins/agents/src/node/index.ts`:

```ts
ctx.hooks.declare({
  id: 'before-permission',
  label: 'allow a tool',
  payload: {
    sessionId: 'string', taskId: 'string', requestId: 'string', providerId: 'string', unattended: 'boolean',
    kind: 'string', title: 'string', command: 'string', paths: 'string[]', root: 'string',
  },
  allows: ['observe', 'veto'],
  timeoutMs: 5_000,
  onTimeout: 'allow',
  order: 'install',
})
```

### The payload

| Field | Meaning |
| --- | --- |
| `requestId` | The parked provider request's canonical ID, scoped to the session. A policy consumer uses it to deduplicate explanation messages without merging distinct permission requests. Added by the sequential Pi plan on 2026-10-03. |
| `unattended` | True for `workflow` and `delegated` sessions, the set `claudeHarness.ts` already calls unattended. "No pushes from a workflow run" is the main case for this field. |
| `kind` | One of `command`, `edit`, `read`, `fetch`, `permissions`, or `other`. ACP's `execute` maps to `command`; `edit`, `delete`, and `move` map to `edit`; `read` and `search` map to `read`. Codex maps by method. |
| `title` | The harness's own summary, as the card shows it. |
| `command` | The command line when the harness sent one, otherwise `''`. |
| `paths` | The paths the call touches when the harness says, otherwise `[]`. |
| `root` | The task's worktree root, so a handler can refuse anything outside it without a second lookup. |

Payload matching is exact, so every field is on every call, empty when the harness gave nothing.

The command and paths are the point of this hook. `core:before-tool-call` withholds arguments so a
handler can't read the agent's work, and that choice is right there. It would make this hook useless:
a policy that can't see `git push --force` can't refuse it. So a veto here is a high grant, like every
veto. An observer here sees every command the agent asks to run. That's the same kind of access an
observer on `before-send` has to every prompt, and neither is marked high. Keep them consistent
rather than adding a per-point flag.

### The modes

Observe and veto only.

- **No transform.** The harness runs its own command. Changing the payload changes nothing the
  harness does.
- **No auto-allow.** A plugin that says no only makes a session stricter. A plugin that says yes on
  the person's behalf is a different, much larger grant. That matches the managed policy layer's
  rule that a local choice can only narrow
  ([sandbox/enterprise-policy.md](./sandbox/enterprise-policy.md)).

### Timeouts fail open, and that is safe here

`onTimeout: 'allow'` means "no objection". The request goes on to the person as it does without the
hook. So a stalled handler costs up to five seconds before the card appears, never an approval
nobody gave. This is the opposite of `core:before-tool-call`, which denies on timeout because nobody
stands behind it.

### Order

`install`, not `priority`. With vetoes only, order changes nothing but which reason is shown first,
and it doesn't earn a handler-chosen number (see [Later](#later-each-with-its-trigger)).

### Where it runs

In `onProviderEvent`, for a `request` of kind `permission`, before the event enters the provider
event queue. Two reasons:

- The queue commits a session's events in order. A handler that takes five seconds there would stall
  every other event from that session, including parallel tool calls.
- The harness is already blocked on this answer, so waiting here costs nothing extra.

### What a veto does

1. The runtime answers the parked request through `live.handle.resolveRequest` with the first option
   of kind `reject_once`. That's `decline` for Codex, never `cancel`, which ends the turn. If no
   option has that kind, the runtime cancels the request. It never picks `reject_always`, because a
   plugin must not write a lasting rule into the harness's own settings.
2. The runtime records the `request` event carrying a new optional field,
   `blocked: { by, reason }`. `by` is the handler's plugin id, taken from the verdict the host
   returns. `applyEventProjection` writes that row as `resolved`, with `blocked` in its resolution.
   The row is never `pending`, so it raises no notification, adds no attention badge, and doesn't
   wake a delegated child's parent.
   A bounded blocked summary is readable through `agents.requests`, including the canonical provider
   request ID, while raw resolution stays private. This lets the separately granted Pi explanation
   consumer react to a confirmed refusal rather than a hook verdict that might be ignored on timeout.
3. `AgentRequestCard.tsx` draws a blocked request as resolved and names who blocked it and why.

The field is optional on the wire type in `plugins/agents/src/contract/wire.ts`. An older client
draws the row as an ordinary resolved request, so the cached query shape needs no new key.

The permission reply gives the model a plain rejection, because neither ACP's nor Codex's reply has
room for a reason. Optional explanation delivery is a separate grant and later queued turn in
[Pi phase 03](./pi/phases/03-session-messages.md). The hook itself never sends that turn.

### Getting the command and paths out of each harness

Each normalizer knows its own protocol, so the extraction lives there and the runtime stays neutral.
The request gains a driver-only `subject`, following the precedent `AgentDriverGeneratedArtifact`
set in `plugins/agents/src/server/drivers/types.ts`. The runtime reads it for the hook, and the event
materializer drops it before the ledger. The command is already in the ledger on the matching tool
call, so storing it twice buys nothing.

- **ACP.** `request.toolCall` carries `kind`, `locations`, and `rawInput`. `paths` comes from
  `locations`. `command` comes from `rawInput.command` when it's a string, which holds for Claude
  Code's Bash tool. Check DeepSeek's shape before relying on it.
- **Codex.** `commandExecution` carries `command` and `cwd`. `fileChange` carries only `reason` and
  `grantRoot`, so `paths` is `[grantRoot]` or `[]` unless the file-change item seen earlier in the turn
  is easy to reach.

## What it does not do

Say these plainly in the owning docs, because a policy people trust too far is worse than none.

- **It sees only what the harness asks about.** A session in a bypass mode, a tool the harness's own
  settings already allow, or an earlier "allow for session" never reaches acorn. This hook applies a
  policy to questions. It doesn't gate every action. acorn chooses the permission mode a session
  starts in, which is the lever for asking more often.
- **It isn't containment.** A refused `rm -rf` can come back as a script the harness doesn't ask
  about. The OS sandbox in [sandbox/](./sandbox/README.md) is the containment answer.
- **It can't change what the model reads.** Removing a secret from a command's output happens inside
  the harness's own loop, out of reach from outside it. acorn can do that only for its own tools.
- **It isn't a policy engine.** Rules live in the handler plugin's code. acorn adds no rule language
  and no settings form of patterns
  ([sandbox/refused.md § No policy engine, and no policy language](./sandbox/refused.md#no-policy-engine-and-no-policy-language)).

## The phases

1. **Subject extraction.** Add `subject` in both normalizers and drop it in the materializer. Cover
   the mappings in `acpNormalizer.test.ts` and `codexNormalizer.test.ts`, including a request with no
   raw input.
2. **The hook and the veto path.** Declare the point, run it in `onProviderEvent`, answer the driver,
   and record the request already resolved. Test with the fake driver (`drivers/fake.ts`):
   - A veto picks the first `reject_once` option.
   - A timeout lets the request through to the person.
   - A blocked request is never published as `pending`.
   - A delegated child's blocked request doesn't wake its parent.
3. **The card.** Draw `blocked` in `AgentRequestCard.tsx` on desktop and in the terminal.
4. **A first consumer.** A small loaded plugin kept outside this repo, the way the machine stats
   plugin is, with two hard-coded rules: no force-push, and no destructive command outside `root`. A
   seam no real plugin uses goes stale ([extensibility.md § Unexercised seams rot](../extensibility.md#unexercised-seams-rot)),
   and a loaded consumer exercises the route carrier, not just `ctx.hooks.handle`. Add a numbered
   manual check to [testing/agents-and-providers.md](../testing/agents-and-providers.md) that drives
   one blocked command through each of Claude, Codex, and DeepSeek.
5. **The owning docs.** Add the row to the hook table in
   [node-side-extension-points.md § Hooks](../plugins/node-side-extension-points.md#hooks), the
   blocked path and the limits above to [managed-agents.md](../managed-agents.md), and the timeout
   reasoning beside the `core:before-tool-call` exception in [security.md](../security.md). Then
   delete this file's design section and keep the comparison.

## Later, each with its trigger

- **Handler-chosen priority.** `order: 'priority'` sorts by a number the handler picks, 500 when it
  picks none. No handler in this repository picks one. The Mods author refuses numeric priorities outright, citing Raymond Chen's observation that
  every author claims the top number. Once two third-party transforms compete on one point, replace
  the number with install order plus a reorder control in **Settings → Plugins**.
- **Telling the model why.** The Pi plan schedules an optional policy explanation consumer once
  attributed messaging lands in [phase 03](./pi/phases/03-session-messages.md). It uses a separate
  grant and capped queued turn; unattended delivery waits for phase 05's operation ownership.
- **Auto-allow.** Trigger: a real request for it. It would be a separate mode with its own high grant,
  and never for unattended sessions.
- **Handlers a person can't turn off.** This belongs to the managed layer in
  [sandbox/enterprise-policy.md](./sandbox/enterprise-policy.md): a managed node could require named
  handlers. Nothing here builds that.
- **Shipping a mod into the Claude sessions acorn starts.** That would reach what acorn can't, like
  output redaction, but only for Claude. Trigger: Mods leaves early access, since its API can change
  without notice until then.

## Refused

- **A hook on every event.** Mods' `*` handler sees every call. In acorn, an audit or analytics plugin
  subscribes to events instead
  ([node-side-extension-points.md § Hooks](../plugins/node-side-extension-points.md#hooks)).
- **Wrapping another plugin's UI or input without an open point.** Mods lets any plugin intercept
  another's button presses. acorn refuses that permanently.
- **Hooks on the token stream.** Mods' `turn.step` lets a handler rewrite the model's output as it
  streams. acorn already refuses hooks on streams, and outside the harness a rewrite would change
  only what the person sees.
- **Moving acorn's hooks to middleware.** acorn's chain gives each handler the payload and a verdict
  to return. It never gives a handler the rest of the chain, so no handler can skip, repeat, or
  outlast the ones after it.

## Verify before building

- `clientFor` and `announce` in `plugins/agents/src/server/drivers/acpDriver.ts`: the request is
  parked before `onEvent` runs, so resolving inside it finds the entry.
- `onServerRequest` in `plugins/agents/src/server/drivers/codexDriver.ts`: the same ordering, and
  `codexServerRequestResponse` in `codexNormalizer.ts` maps `{ optionId: 'decline' }`.
- `onProviderEvent` in `plugins/agents/src/server/sessions/runtimeEngine.ts`: a request held there
  for the hook can land after events that arrived during the wait, and nothing reads the request's
  position.
- `applyEventProjection` in `plugins/agents/src/server/sessions/sessionRepository.ts` and
  `announceRequest` in `lifecycle.ts`: a row written `resolved` publishes nothing that delegation or
  notifications read as pending.
- `runHook` in `packages/node-core/src/server/pluginHost/hooks.ts`: `string[]` payload matching, and
  that `by` comes from the registration.
- `extensionPermissionLine` in `packages/client-core/src/host/trust/permissions.ts`: how the label
  `allow a tool` reads in each mode's sentence.
- DeepSeek's `rawInput` for its shell tool, from a live session.
