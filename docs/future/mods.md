# What acorn takes from Claude Mods

Proposal, 2026-09-29. The permission hook shipped on 2026-10-07 through
[Pi phase 02](./pi/02-permission-veto.md). Its contract lives in
[permission policy](../managed-agents/permission-policy.md); this file keeps the comparison.

Implementation handoffs, 2026-10-03: [Pi phase 02](./pi/02-permission-veto.md) delivers this
hook and its policy consumer; [Pi phase 03](./pi/03-session-messages.md) adds optional
explanations through a separate messaging grant. On 2026-10-07,
[Pi phase 10](./pi/10-harness-bridges.md) added bridges through each harness's own hooks,
which reach the tool calls this hook can't see. Use the [phase plan](./pi/README.md) for
execution order and acceptance.

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
| `prompt.submit` | `agents:before-send`, with observe, transform, and veto | [node-side-extension-points.md](../plugins/hooks.md#hooks) |
| `prompt.context`, `prompt.section` | Context sections and `core:before-snapshot` | [agent-tools.md](../agent-tools/context-sections.md#context-sections) |
| `tool.register` | Agent tool contributions | [agent-tools.md](../agent-tools.md) |
| `tool.check` on acorn's own tools | `core:before-tool-call` | [node-side-extension-points.md](../plugins/hooks.md#hooks) |
| `tool.check` on a harness's permission request | `agents:before-permission`, with observe and veto | [permission policy](../managed-agents/permission-policy.md) |
| `$` as the only door, in a worker | The permission-scoped worker and its owner-bound context | [extensibility.md](../extensibility.md#the-node-half-is-isolated) |
| Adding a noun to `$` | Capabilities with a `contract/` folder | [plugin-map.md](../plugin-map.md#talking-to-another-plugin) |
| `turn.complete`, `agent.spawn` | Agents lifecycle events and managed delegation | [managed-agents.md](../managed-agents.md) |
| `sec-default`, org tiers | Proposed team policy for hosted workers; no local managed policy layer | [cloud team policy](./cloud/isolation.md#team-policy) |

Because these live in acorn rather than in the agent, each works the same for Claude, Codex, and
DeepSeek.

## What acorn keeps doing differently

Mods lets any plugin wrap any method, and the admin's plugin order is the safety model. acorn lets a
plugin change another plugin's behavior only where the owner opened a point
([node-side-extension-points.md § There is no uncooperative extension](../plugins/cooperative-extension-points.md#there-is-no-uncooperative-extension)).
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

## The design, delivered

The agents plugin owns `agents:before-permission`, declared beside `before-send`. It allows observe and
veto, runs in install order with 5 seconds per handler, and passes the request to the person on
timeout. A veto answers the parked request with its first `reject_once` option and records the request
already resolved with `blocked: { by, reason }`. [Permission policy](../managed-agents/permission-policy.md)
owns the payload, the per-harness mapping, and the failure cases.

Two things differ from this file's first design. The payload carries a canonical `requestId` and a
`toolCallId`, and the subject fields are one public type that Pi phase 10's `agents:before-tool` will
reuse. And the ACP driver merges a permission request with the tool call announced before it, because
DeepSeek's request names only the call and leaves the command on the earlier update.

## What it does not do

Say these plainly in the owning docs, because a policy people trust too far is worse than none.

- **It sees only what the harness asks about.** A session in a bypass mode, a tool the harness's own
  settings already allow, or an earlier "allow for session" never reaches acorn. This hook applies a
  policy to questions. It doesn't gate every action. For harnesses with a bridge,
  `agents:before-tool` ([Pi phase 10](./pi/10-harness-bridges.md)) sees every call. acorn chooses the permission mode a session
  starts in, which is the lever for asking more often.
- **It isn't containment.** A refused `rm -rf` can come back as a script the harness doesn't ask
  about. [Security](../security.md) owns the shipped boundaries and their limits; local task
  processes are not isolated by this hook.
- **It can't change what the model reads.** Removing a secret from a command's output happens inside
  the harness's own loop, out of reach from outside it. acorn can do that only for its own tools.
- **It isn't a policy engine.** Rules live in the handler plugin's code. acorn adds no rule language
  and no settings form of patterns.

## The phases

All five shipped in Pi phase 02. The first consumer is
[`docs/future/pi/packages/permission-policy/`](./pi/packages/permission-policy/README.md), and manual
check 156 in [agents and providers](../testing/agents-and-providers.md) drives it through each harness.

## Later, each with its trigger

- **Handler-chosen priority.** `order: 'priority'` sorts by a number the handler picks, 500 when it
  picks none. No handler in this repository picks one. The Mods author refuses numeric priorities outright, citing Raymond Chen's observation that
  every author claims the top number. Once two third-party transforms compete on one point, replace
  the number with install order plus a reorder control in **Settings → Plugins**.
- **Telling the model why.** The Pi plan schedules an optional policy explanation consumer once
  attributed messaging lands in [phase 03](./pi/03-session-messages.md). It uses a separate
  grant and capped queued turn; unattended delivery waits for phase 05's operation ownership.
- **Auto-allow.** Trigger: a real request for it. It would be a separate mode with its own high grant,
  and never for unattended sessions.
- **Handlers a person can't turn off.** This would need an administrator policy and a separate
  proposal. Nothing here builds it. [Cloud team policy](./cloud/isolation.md#team-policy) applies
  to hosted workers and does not require named handlers.
- **Shipping a mod into the Claude sessions acorn starts.** Replaced on 2026-10-07 by
  [harness bridges](../managed-agents/loop-hooks.md), delivered in [phase 10](./pi/10-harness-bridges.md).
  Acorn installs a command hook in the Claude sessions it starts. A Claude mod stays the fallback if
  the per-call process cost is too high. Codex has no bridge, because a host can't install a trusted
  hook there. Output redaction remains Claude-only and deferred.

## Refused

- **A hook on every event.** Mods' `*` handler sees every call. In acorn, an audit or analytics plugin
  subscribes to events instead
  ([node-side-extension-points.md § Hooks](../plugins/hooks.md#hooks)).
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
