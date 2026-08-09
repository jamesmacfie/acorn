# rollbar → loaded plugin

**Blockers: none.** The recommended first move, and the reference the other three assume you have
read.

## Why this one first

Smallest surface of the four: no tables, no capabilities published or consumed, no streams, no
agent tools, no Electron. Its entire node half is three lines:

```ts
// plugins/rollbar/src/node/index.ts, in full
export const rollbarPlugin = (): NodePlugin => ({
  name: 'rollbar',
  init: (ctx) => ctx.providers.integration(rollbarProvider, rollbar),
})
```

And it is the shape most third-party authors will actually build — an external item source with a
rail list, a detail pane, and promotion into tasks. Proving it end to end proves the tier for
every tracker and monitoring integration that follows.

## What it does today

| Piece | Where | Becomes |
| --- | --- | --- |
| Integration provider + connection descriptor | `server/provider.ts` | Unchanged; registered with a fetch handler |
| Routes under `/v2/p/rollbar` | `server/routes/rollbar.ts` | `ctx.routes.fetch` / fetch handler on `providers.integration` |
| Item normalization | `server/normalize.ts`, `occurrenceResources.ts` | Unchanged — pure functions over provider payloads |
| Rail source + promotion | `client/sourceContribution.ts` | Descriptor source + `createTask` verb, or a frame; see below |
| Browse and detail panes | `client/RollbarBrowse.tsx`, `RollbarPane.tsx`, `RollbarItemPanel.tsx`, `RollbarOccurrenceView.tsx` | `frame` surfaces |
| Sync policy | `server/syncPolicy.ts` | Unchanged |

No plugin database: items live in core's external-item store, reached through the provider runtime
on the request context.

## The two decisions

**1. Descriptor source or frame browse?** Rollbar's browse pane is a real list UI with filtering
and an occurrence viewer. Two options, and they are a genuine trade rather than a right answer:

- *Descriptor source + frame detail pane.* The rail rows are drawn natively (pixel-identical to
  first-party, live when nothing is mounted, works offline from cache), and clicking one opens the
  frame. Promotion is the host's `createTask` verb. **Recommended** — it exercises both tiers,
  which is the point of the exercise, and the rail is where "does this feel native" is judged.
- *Frame for everything.* Simpler port, one UI to move. But then nothing exercises descriptors,
  and the rail loses its offline behaviour.

**2. Promotion.** Today it is a `SourcePromotion` callback bundle — `canPromote` refuses without a
project and a branch, `prepare` builds a `TaskSeed`, `create` posts it, `attachToCurrentTask`
calls `addTaskLink`. On the descriptor path the host runs all of that: rows carry an optional
`task` block that the node half fills in, and the host creates and links. Rollbar's `canPromote`
strictness — no branch, no promote — becomes the modal's own requirement, which it already
enforces. If you need a rule the modal cannot express, that is the signal to use a frame instead.

## Manifest sketch

```jsonc
{
  "id": "rollbar",
  "name": "Rollbar",
  "version": "1.0.0",
  "apiVersion": "1",
  "node": "./dist/node.js",
  "client": "./dist/client.js",
  "permissions": {
    "api": ["core.tasks:read", "core.tasks:write", "core.projects:read"],
    "events": ["runtime:task-archived"],
    "node": { "core": ["tasks", "projects:read"], "secrets": true, "net": ["api.rollbar.com"] }
  },
  "contributions": {
    "frames": [
      { "target": "pane", "id": "rollbar", "label": "Rollbar", "glyph": "circle-dot", "order": 40 }
    ],
    "sources": [{
      "id": "rollbar-items", "label": "Rollbar", "glyph": "circle-dot", "order": 30,
      "providerId": "rollbar",
      "items": "/v2/p/rollbar/rail-items",
      "onSelect": { "verb": "openPane", "pane": "rollbar" }
    }]
  }
}
```

`secrets: true` is required — the provider spends the owner's Rollbar token. `net` is disclosure
only at rung 1; declare the real host anyway, because the trust prompt shows it and because rung 2
turns these declarations into grants.

Keep `id: "rollbar"` exactly. It binds the route namespace and the provider id; changing it
orphans existing connections.

## Sequence

1. Build the loaded version alongside the built-in, under a different id (`rollbar-next`) so both
   can run. Change the id back only at cutover.
2. Node half first: provider + fetch routes, verified against a real Rollbar token. Everything
   downstream depends on the provider runtime working.
3. Descriptor source. Check the rail against the built-in side by side — this is where a port
   silently loses polish.
4. Frames for detail. Tokens arrive over the port; check both appearance axes.
5. Promotion, including the link. Then disable the built-in and use only the loaded one for a
   week before deleting anything.

## What to write down

The point of going first is the findings, not the plugin. Record, in the shape
`docs/third-party-next/` used:

- Anything the descriptor tier could not express that the component source could.
- Any permission you had to declare that surprised you, and any you expected to need and did not.
- Where the frame felt wrong — latency, appearance, focus, keyboard.
- What you did **not** need. A verb, a scope or a registry nothing used is evidence for deleting
  surface before three plugins depend on it.

## Done when

Installed from a tarball on a real Node, browsing items, promoting one into a task with the item
linked, surviving disable/enable and an update with a permission change — and the built-in
deleted, not just disabled.
