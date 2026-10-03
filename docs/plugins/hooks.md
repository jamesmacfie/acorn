# Hooks

This page covers hooks, the extension point kind for deciding before something happens. It's part of
the [plugin reference](../plugins.md).

## Hooks

Hooks answer questions such as "before I push, does anyone object?" and "before I send this prompt,
does anyone want to change it?" The owner declares the moment and what's allowed at it, contributors
register a handler, and the host runs the chain and hands the owner a verdict
(`node-core/server/pluginHost/hooks.ts`).

A hook isn't an event. An event has already happened, fans out without waiting, and carries state. A
hook runs before, in an ordered chain, with a return value, a timeout, and validation. An owner that
declares no hook has said no to interceptors, the same way a producer that declares no `emits` has
said no to listeners. An audit or analytics plugin is an event subscriber.

## Declare a hook

The owner declares a hook in its manifest or through `ctx.hooks.declare`:

```json
{ "id": "before-push", "kind": "hook", "label": "push",
  "payload": { "taskId": "string", "branch": "string", "force": "boolean" },
  "allows": ["observe", "veto"], "timeoutMs": 5000, "onTimeout": "allow" }
```

- `payload` is the declared shape, in the vocabulary a remote tree's props use: `string`, `number`,
  `boolean`, and arrays of those. A payload is a decision's subject, not a document.
- `allows` is the subset of `observe`, `transform`, and `veto` the owner permits. A handler asking
  for an unlisted mode gets nothing.
- `timeoutMs` limits each handler. `onTimeout` is `allow` or `deny` and applies to veto handlers only.
- `order` is `priority` (the handler's own number, then install time) or `install`. Ties are stable.
- `collect` runs every veto instead of stopping at the first, so the owner can show every reason.

The owner's node half runs it at the moment:

```ts
const verdict = await ctx.hooks.run('before-push', { taskId, branch, force })
if (!verdict.ok) return { ok: false, reason: `${verdict.by}: ${verdict.reason}` }
await push(verdict.payload)   // transformed, or the original if nobody transformed
```

## Register a handler

A contributor registers a handler and names the owner:

```json
{ "id": "scan-push", "point": "changes:before-push", "label": "Secret scan",
  "route": "/v1/p/secret-scan/push", "mode": "veto", "priority": 50 }
```

The host calls the route, on the contributor's own namespace, with the payload. A compiled plugin
registers a function through `ctx.hooks.handle` instead. The host wraps both in one closure at
registration, so nothing in the chain knows which it has.

| `mode` | Answers | What the host does with it |
| --- | --- | --- |
| `observe` | Anything | Drops it unread. Observers run beside the chain, never in it |
| `transform` | `{ payload }` | Validates it against the owner's declared shape. A violation counts as no change and is recorded |
| `veto` | `{ ok: true }` or `{ ok: false, reason }` | `reason` is capped display text, and the host stamps `by` with the contributor's id |

## Chain rules

These rules have no exceptions:

- Handlers never see each other. Each gets the payload as it stands when its turn comes.
- Order follows the owner's rule, then install time.
- A handler that throws or times out is skipped and recorded on its roster row. A timed-out veto is
  treated as `onTimeout` says. The default is to fail open, so a stalled plugin can't block a push.
- The chain stops at the first veto unless the owner set `collect`.
- A transform's output is validated against the same shape as its input.
- Both directions appear in the trust prompt with host-owned copy, such as "can stop a push in the
  changes plugin". A handler that changes or stops another plugin's decision is a high grant.

The owner draws the refusal in its own UI with the stamped provenance, and decides whether "push
anyway" exists.

## Hooks that exist

Core declares four hooks, because core owns those choke points:

| Owner | Hook | Allows | Use |
| --- | --- | --- | --- |
| core | `core:worktree-created` | observe, transform | Setup scripts. The terminal plugin handles it |
| core | `core:task-archiving` | observe, transform | Stopping work a task owns before its worktree goes. Runs on every archive, after the teardown script. The agents plugin stops the task's provider processes |
| core | `core:before-tool-call` | observe, veto | Approval gates beyond the built-in tiers. `onTimeout: deny`, alone among these |
| core | `core:before-snapshot` | observe, transform, veto | Budget shaping and PII stripping. The payload is section names |
| changes | `changes:before-commit` | observe, transform, veto | Commit lint and message helpers |
| changes | `changes:before-push` | observe, veto | Secret scanning, changesets, and branch protection |
| agents | `agents:before-send` | observe, transform, veto | Prompt policy, redaction, and context injectors |
| terminal | `terminal:before-run-target` | observe, veto | Change freezes and environment checks. Runs after the repo-config trust gate and before the session starts |
| workflows | `workflows:before-step` | observe, veto | "No deploys today" from an incident tool |
| editor | `editor:before-save` | observe, transform, veto | Format and lint on save |

A payload's booleans are part of the decision. `changes:before-commit` carries
`{ taskId, branch, message, amend }`, and `changes:before-push` carries `{ taskId, branch, force }`.
A commit-lint handler usually leaves a reword of an existing commit alone, and a branch-protection
handler refuses only the push that replaces commits. Payload matching is exact, so every call carries
every declared field (`CHANGES_HOOKS` in `plugins/changes/src/server/localGit.ts`).

## What isn't a hook

These are refused:

- Hooks on streams or per-keystroke paths: PTY output, editor keystrokes, and the agent token stream.
- A transform that changes the payload's shape.
- A hook the owner didn't declare, or a mode it didn't allow.
- Hooks that run on the client. The chain runs on the Node.

Two seams look like hooks and aren't. [Task checks](./task-checks.md) answer with a concern and an
opt-in cleanup, which a `{ ok, reason }` verdict can't express. `core:task-archiving` has no veto, and
it exists for work that must stop whatever the owner chooses. The `routeCapability` seams in
`server/bridge.ts`, such as `scheduler.list()`, are single-provider service calls, not decisions.
