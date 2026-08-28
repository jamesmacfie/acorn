# Hooks: a turn in a decision before it happens

Part of [docs/future/layout/](./README.md). Everything else in this folder is about drawing. Hooks
are about deciding. "Before I push, does anyone object?" "Before I send this prompt, does anyone want
to change it?" The owner declares the moment and what is allowed at it, contributors register a
route, the host runs the chain and hands the owner a verdict.

## A hook is not an event

An event has already happened. "Task archived" cannot be blocked after the archive. Events fan out,
fire and forget, carry state rather than deltas, and are designed in
[docs/future/events.md](../events.md), which this folder does not touch. An audit or analytics
plugin is an event subscriber.

A hook runs *before*, in a chain, with a return value. It is request and response, ordered, timed
out, and validated. The two are different contracts and they stay different: a producer that
declares no `emits` has said no to listeners, and an owner that declares no hook has said no to
interceptors.

The interceptor plugin the owner described (forward, block, or modify, then use the modified data in
its own UI) is three existing or planned pieces: a `transform` handler on the node changes the
payload; the plugin emits on its own `plugin:<id>:*` channel, which works today; its remote card or
rectangle redraws from that channel.

## What exists

Five single-slot, first-party-only hooks, none of them called that:

- `WORKTREE_CREATED` (`node-core/src/main/taskWorktree.ts`), a capability the terminal plugin
  provides to run setup after a worktree is created. Single slot.
- `taskChecks` (`node-core/src/server/plugin/taskChecks.ts`), what a plugin says when a task is
  archived and the cleanup it offers. Declared in the manifest for loaded plugins; the closest
  existing thing to a veto-shaped hook.
- The `routeCapability` seams in `node-core/src/server/bridge.ts`, five single-slot hooks that a
  compiled plugin fills.

Generalising these the way extension points generalised `pane.footer` is the whole design.

## The contract

### Owner

```json
"extensionPoints": [{
  "id": "before-push",
  "kind": "hook",
  "payload": { "branch": "string", "remote": "string", "commits": "string[]" },
  "allows": ["observe", "veto"],
  "timeoutMs": 5000,
  "onTimeout": "allow",
  "order": "priority"
}]
```

- `payload` is the declared shape, in the same small vocabulary the remote tree uses for props:
  `string`, `number`, `boolean`, `blob`, arrays and objects of those.
- `allows` is the subset of `observe | transform | veto` the owner permits. A handler asking for a
  mode not listed gets nothing.
- `timeoutMs` bounds each handler. `onTimeout` is `allow` or `deny` and applies to veto handlers
  only; observers and transformers that time out are skipped.
- `order` is `priority` (owner-declared priority on the handler, then install time) or `install`.

The owner's node half calls it:

```ts
const verdict = await ctx.hooks.run('before-push', { branch, remote, commits })
if (!verdict.ok) return c.json({ error: verdict.reason, by: verdict.by }, 409)
await push(verdict.payload)   // transformed, or the original if nobody transformed
```

### Contributor

```json
"extensions": [{
  "id": "scan-push",
  "point": "changes:before-push",
  "route": "/v2/p/secret-scan/push",
  "mode": "veto",
  "priority": 50
}]
```

The route is on the contributor's own namespace and is called by the host with the payload. It
answers:

- `observe`: anything; the answer is ignored. Called alongside, not in the chain.
- `transform`: `{ payload }`, validated against the declared shape. A shape violation is treated as
  no change and recorded.
- `veto`: `{ ok: true }` or `{ ok: false, reason }`. `reason` is display text; the host stamps `by`
  with the contributor's id.

### Chain rules

The host runs the chain, and these hold without exception:

- Handlers never see each other. Each gets the payload as it stands when its turn comes.
- Order is the owner's rule, then install time. Ties are stable.
- Observers run in parallel with the chain and cannot affect it.
- A handler that throws or times out is skipped and recorded on its roster row. A timed-out veto is
  treated as `onTimeout` says. Fail open by default, because a plugin that stalls must not brick a
  push.
- The chain stops at the first veto unless the owner sets `collect: true`, in which case every veto
  runs and the owner receives all reasons.
- A transform's output is validated against the same shape as its input. A handler cannot turn a
  payload into something the owner did not declare.
- Both directions appear in the trust prompt with host-owned copy: for the owner, "lets other
  plugins act before it pushes"; for the contributor, "can stop a push in the changes plugin" or
  "can change a prompt before the agents plugin sends it." The plugin id and the verb are
  interpolated from a fixed table; manifest text never is.

### What the user sees

The owner draws the refusal in its own UI with the provenance the host stamped:

```
Push stopped                                   by secret-scan
Secret in .env.local:3. Remove it or add it to the allowlist.
[Open file]  [Push anyway]
```

Whether "push anyway" exists is the owner's decision; the hook says no, and the owner says what no
means.

## The first hooks

Convert the five existing seams first, so first-party code proves the shape before a stranger's
handler runs. Then open these, in the order their consumers appear:

| Owner | Hook | Allows | Who wants it |
| --- | --- | --- | --- |
| changes | `before-push` | veto | secret scanning, changesets |
| changes | `before-commit` | transform (message), veto | commit lint, message helpers |
| agents | `before-send` | transform (text, attachments, context) | prompt policy, redaction, context injectors |
| agents | `before-tool-call` | veto | approval gates beyond the built-in tiers |
| terminal | `before-run-target` | transform (env) | 1Password, direnv, Vault: secrets into a worktree without touching disk |
| workflows | `before-step` | veto | "no deploys today" from an incident tool |
| context | `before-snapshot` | transform, veto | budget shaping, PII stripping |
| editor | `before-save` | transform | format on save |

`WORKTREE_CREATED` becomes `core:worktree-created` with `observe` and `transform` (setup commands);
`taskChecks` becomes `core:before-archive` with `veto` and its cleanup offer as a `transform` on the
plan. The `routeCapability` seams become hooks on the routes they guard.

## Hooks and the UI

Two places hooks touch the drawing side, so one vocabulary covers both:

- **Across a rectangle slot.** The owner declares `hooks.calls` and `hooks.handles` on the point,
  and `slot.call('document-changed', { text })` is a hook with one handler, the occupant. Same
  payload vocabulary, same validation, same trust copy.
- **From a remote card.** A `Button` in a contributor's tree can fire a hook the owner declared
  (`onPress` → the plugin's worker → `bridge.hooks.call`), which is how "insert this text into the
  composer" works without the contributor touching the composer.

## Refused

- Hooks on streams or per-keystroke paths (PTY output, editor keystrokes, agent token stream).
  The events folder refused those as events; a hook costs more than an event.
- A transform that changes the payload's shape.
- A hook the owner did not declare, or a mode the owner did not allow.
- Hooks that run on the client. The chain is node-side; a client-only hook would fail the delivery
  delivery rule (node-emitted, never renderer-local; `docs/plugins.md § Hearing a core event`) for the same reason a client-only event does.

## Tests

- A veto handler that times out with `onTimeout: allow` does not stop the push; with `deny` it does.
- A transform returning an extra field is treated as no change and recorded.
- Two veto handlers with `collect: true` both run and both reasons reach the owner.
- A handler on an undeclared hook, or an undeclared mode, is never called and appears in the
  developer view.
- The five converted seams behave as before under their existing tests.

## Doors left open

- Hooks are node-side and host-agnostic; nothing here depends on the client.
- The payload vocabulary is the tree's prop vocabulary, so a terminal or PWA client sends and
  receives the same shapes.
