# Phase 6: preview is absent where it cannot draw

Status: not started. Waits on nothing.

## Goal

A host without the preview seam never offers the preview pane: no rail entry, no layout membership,
no dead-end empty state. On hosts that have the seam, nothing changes. And the pane's own chrome —
the parts outside the webview rectangle — stops being raw DOM.

## Why this phase, and why now

The decision (README § Decisions taken) is that preview stays pixels-only; the terminal never draws
the page. What is wrong today is not the pane but the gate: the contribution says
`requires: 'desktop'`, and "am I the desktop" is the wrong question — the platform contract already
models a desktop shell that ships without preview views, and tests that shape. On such a host the
rail lists the pane and the pane renders "needs the desktop app", which is the host lying about what
it can draw. The gate mechanism is already uniform (`requires` on every contribution the host
filters before drawing); it is one variant short.

## Scope

In:

- A third `HostRequirement` variant in `packages/client-core/src/infra/node/hostCapabilities.ts`:
  `{ seam: SeamGroup }`, answered by the platform contract's probe for that group. One arm in
  `meets`, reactive the way the plugin arm is if the probe is; the seam probes are boot-static
  today, which is fine.
- `plugins/preview/src/client/PreviewTaskPane.tsx`: `requires: 'desktop'` becomes
  `requires: { seam: 'preview' }`. The comment there calls itself "the one surviving desktop gate
  outside a test" — this phase retires it, and the audit section in `docs/frontend.md` that tracks
  desktop gates records the retirement.
- `plugins/preview/src/client/PreviewPane.tsx`: the render-time dead end ("needs the desktop app")
  becomes unreachable and is deleted. While in the file, the raw `<section>` root with its inline
  grid style, the `<code>` runs in the empty-state prose, and the raw `window` resize listener are
  cleaned to kit — the resize concern belongs to the rectangle's own layout, and the prose becomes
  `Text`/`CodeBlock` or plain words. Only the chrome outside the webview rectangle is in scope; the
  rectangle stays a rectangle.

Out: any preview fallback UI for hosts without the seam — absence is the design. Out: gating any
other contribution; the variant is general, but this phase changes one caller and lets the next
gate migrate when it is touched.

## Design detail

**The seam probe is the truth the gate should read.** The platform contract defines the `preview`
group with its members and resolver, and its own test pins the no-preview shell shape. Pointing
`requires` at the group means the rail's answer and the pane's ability can never disagree — the same
object answers both. `'desktop'` remains for things that are genuinely about the desktop shell (the
folder picker's comment in the contract explains the distinction), so the variant is an addition,
not a replacement.

**Why not `when`.** `when` is the contribution's predicate over task context; this is a host
question, and the registries already split the two on purpose. Putting a host probe in `when` would
recreate the three-gate confusion the 2026-08-27 finding cleaned up.

## Code touched

- `packages/client-core/src/infra/node/hostCapabilities.ts`
- `plugins/preview/src/client/PreviewTaskPane.tsx`, `plugins/preview/src/client/PreviewPane.tsx`
- `docs/frontend.md` § the desktop gate audit (a row retires)

## Tests

- A host-capabilities test: a contribution with `{ seam: 'preview' }` is filtered out when the probe
  returns null and kept when it resolves, alongside the existing `'desktop'` and `{ plugin }` cases.
- The pane-availability path already has coverage through the rail's filter; extend one case to the
  new variant.
- A scan assertion or existing contract test keeps the no-preview shell shape valid.

## Docs owed

- Whichever doc owns the `requires` vocabulary (the plugin-authoring or panes doc) gains the
  variant. See [docs-migration.md](./docs-migration.md).

## Doors left open

1. Migrating other `'desktop'` gates to seam gates as they are touched; the audit in
   `docs/frontend.md` is the worklist.
2. Reactive seam probes, if a host ever gains a seam at runtime; today boot-static is true.

## Done when

- On a build without preview views, the rail never lists the preview pane and no code path can
  render its dead end (the dead end no longer exists).
- On the normal desktop, the pane appears and works exactly as before.
- `PreviewPane.tsx` scans clean of raw elements outside the rectangle mount.
- `pnpm lint` and the affected tests are green.

## Verify before building

- `PreviewTaskPane.tsx` still gates on `requires: 'desktop'` and still calls itself the one
  surviving desktop gate.
- `hostCapabilities.ts` still has exactly two `HostRequirement` variants.
- The platform contract still defines the `preview` seam group and still tests the shell shape that
  lacks it (`packages/client-core/src/infra/platform/contract.ts` and its test).
- The rail still filters through `paneAvailable` → `hasHostCapability`
  (`packages/client-core/src/features/tasks/TaskPaneHost.tsx`,
  `packages/client-core/src/host/registries/panes/panes.ts`).
