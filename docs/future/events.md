# Events: what is left

Status: shipped 2026-08-28, with three items open. This file replaces the `docs/future/events/`
folder (six files; `git log --follow -- docs/future/events` has them). The design and its deviations
moved to the owning docs when they shipped, so nothing here restates them:

- `docs/plugins.md § Hearing a core event` and `§ Hearing another plugin`: `ctx.events.on`, the
  `emits` declaration, the cross-plugin grant, the trust sentence, the admission rule, and the
  refusals.
- `docs/plugin-map.md § Events`: the orientation version.
- `packages/protocol/src/nodeEvents.ts`: the core catalogue (`plugins`, `tasks`, `connection`,
  `head`, `run`, `agent-session`, `project`, each `:changed`), one host-owned sentence per entry.
- `docs/plugin-authoring.md § Permissions`: what a loaded plugin declares to hear or to be heard.

What shipped, in one line each: every core event in the catalogue is emitted node-side under a
`<noun>:changed` name, worktree lifecycle folded into `tasks:changed`; every catalogued plugin verb
except preview's is emitted on its plugin's own channel; `emits` exists in the manifest and on
`NodePlugin`; a subscriber names another plugin's verb in `permissions.events` and hears it on the
node and in a client bundle, frame or tree alike; workflows hears `plugin:github:checks-changed`
instead of polling.

## Open

### 1. preview: `url-changed` and `navigated`

The most requested cross-plugin fact in the integration survey (Lighthouse, accessibility audits,
visual regression, link checking all start from the preview URL), and the one the delivery rule
disqualifies as the code stands: the URL is derived per render in the renderer
(`plugins/preview/src/client/PreviewTaskPane.tsx`) on a desktop-only path. Three of its four
branches are already computed node-side (`harness.ts`, `worktree.ts`), so the honest version moves
the resolution ladder to the node and emits `plugin:preview:url-changed`
`{ taskId, url, source: 'run-target' | 'config' | 'script' | 'recipe' }` from there. That move is a
prerequisite, not a nicety; `navigated` `{ taskId, url }` follows it and has `webview:navigated` as
the client-bundle precedent for the shape.

Done when: a node with no client attached knows a task's preview URL and broadcasts a change; the
preview pane reads it instead of re-deriving it.

### 2. Render `emits` on the settings page

The roster row carries `installed.emits`, optional so the persisted query cache needed no key bump,
and nothing draws it. Settings → Plugins should list a plugin's declared verbs with their
descriptions, because that list is the only way a person evaluating a cross-plugin grant can see what
"live updates from the github plugin" means. Small, host-drawn, no bridge verb.

### 3. Connection deletion

`connection:changed` covers create, rotate, test, disable, revoke, and the demotion to `needs-auth`.
Deletion was left out on purpose because a consumer re-reading a deleted id gets a 404 rather than a
status, so the payload shape needs a `deleted: true` branch or a separate `connection:removed`, and
that is a decision, not a line. Decide, then emit from the delete path in
`server/integrations/connections.ts`.

## Two ceilings, recorded

Both are in `docs/plugins.md § Hearing another plugin`; repeated here because they are the things a
future reader will trip over.

- The client side does not consult the producer's `emits`. A producer's frames and trees reach every socket
  regardless, so the check would be cosmetic; the node-side check is the one that holds.
- Init order is not a dependency contract, so a consumer that subscribes before its producer's init
  has run sees an "absent" producer and is admitted even for an undeclared verb. The frames never
  arrive, so the contract holds; only the error is lost.

## Not built here, by design

Focus changed lands in the layout programme's phase 2
([layout/phase-2-focus-and-keymap.md](./layout/phase-2-focus-and-keymap.md)), from the host-owned
region store, on the client bus only. The refusals (file saved, streams, per-keystroke, machine-scale
invalidation, process and port lifecycle, raw user activity, request and query payloads, compose up
and down) are in `docs/plugins.md § What is not an event`, with the argument for each.
