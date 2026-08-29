# Phase 5: the loaded four move to the remote root

Status: **shipped**. Behaviour is owned by `docs/plugin-authoring.md` § The client half,
`docs/panes.md` § Layout model, `docs/plugins.md` § Remote trees and `docs/ui-design.md` § The closed
kit. What follows is the plan as written, plus the deviations at the end.

## Goal

Move http, database, linear, and rollbar from `mountFrame` in an iframe to `mountTree` in a worker,
declare their layouts, and delete their stylesheets. These four are already nearly trees because a
frame with no shared CSS pushed them onto the kit, so they are the first real proof of the remote path
on production plugins, with the iframe path still there if anything goes wrong.

## Why this phase, and why now

Every mechanism exists after phase 4. These plugins exercise the worker, layouts from a manifest,
`Grid`, `document-over-frame` with a tree region, and the SDK, on code that is small and regular.
Their visual output is already the kit's, so "minimal acceptable UI difference" is easy to judge.

## Scope

In: the four plugins' `src/frame/` directories become `src/tree/` (or stay named and change entry),
their manifests gain `layout` and `regions`, their `.css` files are deleted, their `mountFrame` calls
become `mountTree`, and every raw `div` and `span` becomes a kit node. Routes, node halves, and
permissions are unchanged.

Out: any behaviour change. The ref panel for linear and rollbar (a `refPanel` frame) also moves,
because a panel body is a tree; the host keeps drawing the box.

## Per plugin

### http

Layout `list-detail`; the detail region is `header-body`. Tree: `TreeRow` list of saved requests with
`Section` groups; `Toolbar` with a method `Select`, url `Input`, Send `Button`; `Tabs` node for
params, headers, body with `KeyValueEditor` and `Textarea`; a status `Inline` (`Badge` status, `Text`
timing and size); `Tabs` for response body (`CodeBlock`) and headers (`Facts`). The save modal is a
`Modal` node. Variable interpolation preview on the URL, which was per-keystroke, becomes a preview
line updated on commit; this is an accepted difference.

Files: `plugins/http/src/frame/{index.tsx,app.tsx,HttpPanel.tsx,RequestTabs.tsx,ResponseView.tsx,
HttpVariables.tsx,SaveRequestModal.tsx}` and its CSS.

### database

Layout `document-over-frame`; the frame region is a tree. Tree: `Toolbar` with a saved-query
`Picker` and Run; `Grid` replacing `ResultGrid`; a `Fold` for the row detail replacing the `aside`;
`Modal`s for save and generate. The host Monaco document region is unchanged.

Files: `plugins/database/src/frame/{index.tsx,app.tsx,DatabasePanel.tsx,ResultGrid.tsx,
SaveQueryModal.tsx,GenerateSqlModal.tsx}`. `ResultGrid.tsx` is deleted.

### linear

Layout `header-body`; the body is a `Tabs` node. Tree: `Heading` with eyebrow, `ChipRow`, `Tabs`
(overview as `Facts` and `Markdown`; comments as `Timeline` with `Composer`). Uploaded images that
were inlined as `data:` URLs become links, an accepted difference on this path; the `Image` node may
carry them where the host allows.

Files: `plugins/linear/src/frame/{index.tsx,app.tsx,LinearIssueView.tsx}` and `linear-frame.css`.

### rollbar

Layout `header-body`; the body is a `Tabs` node. Tree: `Heading`, `ChipRow`, `Tabs` (overview as
`Facts`; occurrences as `list-detail` of `Row`s with the stack as `CodeBlock`).

Files: `plugins/rollbar/src/frame/{index.tsx,app.tsx,RollbarItemView.tsx}` and its CSS.

## Design detail

- Each plugin's manifest: `frames[].layout` and `regions`, with `regions.*` naming `remote:` entries.
  The `document-over-frame` entry for database keeps its `routes`.
- The package builder (`acorn-plugin.config.mjs`, `framework: 'solid'`) targets the remote adapter;
  the `framework` key stays for phase 9 to reconsider.
- Ref panels: `refPanel` frames for linear and rollbar become `remote` contributions with target
  `refPanel`; `PluginRefPanel.tsx` mounts a `TreeHost` in the box it already draws.
- The iframe path is not deleted here; a manifest without `layout` still gets a frame. That is the
  fallback if a plugin has to be reverted mid-phase.

## Code touched

- The four plugins' frame directories, manifests, builder configs, and stylesheets.
- `packages/client-core/src/plugins/frames/PluginRefPanel.tsx`: tree body.
- `packages/client-core/src/plugins/frames/register.ts`: the `pane` and `refPanel` branches mount a
  `TreeHost` when the surface declares a layout with remote regions.

## Tests

- Each plugin's existing frame tests (`app.test.tsx` where present) pass against the tree version,
  rendered through the direct path in jsdom.
- A worker-path render of each pane in the jsdom tier matches the direct path.
- `grep -rln "\.css" plugins/{http,database,linear,rollbar}/src` is empty.
- No raw `div` or `span` in the four plugins' tree directories.

## Docs owed

- `docs/plugin-authoring.md` § "The client half", § "Reaching the bridge", § "What the bridge
  carries", and the complete example: `mountTree` and a tree plugin; the frame path becomes an
  appendix.
- `docs/third-party/README.md` § "Monaco does not fit in a frame": the premise is removed.
- `docs/panes.md` § "Shipped panes": the four rows say "tree" not "frame".

## Doors left open

- No plugin CSS remains in the four, so nothing about them is DOM-only.
- Each declares a layout with documented projections.

## Done when

- All four render through workers in the running app; the trust prompt is unchanged; the panes look
  as they did within the accepted differences above.
- Four stylesheets are deleted.
- `pnpm lint` and `pnpm test` are green.

## Verify before building

- The four plugins still have `src/frame/index.tsx` calling `mountFrame` and a `.css?inline` import.
- `plugins/database/src/frame/ResultGrid.tsx` (deleted) exists and is the custom grid.
- `packages/client-core/src/plugins/frames/PluginRefPanel.tsx` draws the box and mounts a
  `PluginFrame`.
- Each plugin's `acorn-plugin.config.mjs` (or equivalent) names `framework: 'solid'`.
- Re-run the raw-tag survey for these four to size the work.

## What actually shipped, and where it differs

Six deviations, all decided while building and all for the same underlying reason: the kit as phase 0
left it was written for the shell, and the wire only carries data.

1. **Three panes are `single`, not the layout the plan named.** http was to be `list-detail` and
   rollbar and linear `header-body`. A pane layout fills each region from its own renderer, and the two
   columns of the API panel share the selection, the draft and the send result — two regions are two
   renderers with no way to hold one signal between them. So the split stayed a `ListDetail` inside one
   tree, and the pane declares `single`. Database keeps `document-over-frame`, where the two regions
   genuinely are two things.
2. **The kit grew seven nodes and lost four prop names.** A remote tree names one type per node and can
   only carry a handler under one of the kit's eleven events, and neither was true of the shipped kit.
   `Text` (named in 04-kit.md and never built), `ToolbarSpacer`, `ModalBody`, `ModalActions`,
   `TabPanel`, `ListColumn` and `DetailColumn` are new; `Modal.onClose` became `onDismiss`,
   `Input`/`Textarea` `onCommit` became `onChange`, and `Grid.onSelectRow` became `onSelect`.
   `docs/ui-design.md` § The closed kit carries the rule those all follow from.
3. **Three components grew a data form beside their callback form.** `Picker` takes `items` and filters
   them itself, `ListDetail` takes column children instead of a `list` element, and `Composer` holds its
   own live text and hands it to `onSubmit`. The callback forms stay for shell code.
4. **A layout is valid on a reference panel and a settings page, not only a pane.** Both had to move —
   linear's panel and http's variables page are the same bundle as their panes — and `single` is the
   only layout either may name, because the host draws everything around them.
5. **Rollbar has no `refPanel` frame to move.** The plan named one for both; only linear declares one.
6. **Four accepted UI differences, each recorded in the owning doc.** A curl command pasted into http's
   URL bar expands on commit rather than on paste, and the method chip is no longer colour-coded per
   verb (`docs/http-client.md`); linear no longer inlines private uploads, so an image in a ticket is a
   link (`docs/integrations.md`); and linear and rollbar dropped the brand headers they drew because an
   iframe had no chrome to borrow.

One thing the plan asked for that is not here: a per-plugin test that renders each pane through a real
worker and diffs it against the direct path. A worker needs a built bundle on disk and jsdom has no
`Worker`, so what is pinned instead is everything downstream of the JSX preset —
`client-core/src/plugins/tree/remoteSolid.test.tsx` renders the kit's node components through the
remote root and `TreeHost` and diffs that against the components themselves. The preset itself is the
running app's business, and `docs/testing.md`'s smoke checklist is where it is checked.
