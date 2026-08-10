# 04 — Frames should use Solid and acorn's UI building blocks

**Resolved.** Original severity: medium.

## Resolution

The Rollbar frame is now a Solid application split into an async bridge/data orchestrator and a
presentation component. It uses `Button`, `Badge`, `Row`, `Tabs`, and `Spinner` directly from
`@acorn/plugin-api/ui`; the manual element factory and render reconciliation are gone.
The facade's connected shell exports moved to `@acorn/plugin-api/ui/host`, keeping the frame entrypoint
presentation-only and tree-shakeable.

The package builder remains framework-agnostic. Client builds accept a per-package Vite plugin list,
and Rollbar opts into `vite-plugin-solid`; a vanilla frame uses no transform and another framework can
supply its own. Rollbar declares its own `solid-js` dependency deliberately because its isolated
document is a separate reactive realm from the shell.

Electron main now generates a `/ui.css` link in every plugin document and serves a build-inlined
manifest of the same presentation-only stylesheets used by the shell. The frame bridge projects the
complete theme, style, and invariant token sets, while the smaller canvas token contract remains
unchanged. Shared components therefore receive both appearance axes without a plugin carrying or
versioning a copied stylesheet.

The intermediate authoring contract is documented in `docs/plugins.md`: in-repo frames should import
`@acorn/plugin-api/ui` now; genuinely external resolution waits for the UI kit to be published, at
which point only the package name changes.

## What is wrong

`plugins/rollbar/src/frame/app.ts` builds its UI with hand-rolled DOM helpers:

```ts
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
```

There is no design reason for this. It is a toolchain gap: the client half of
`apps/node/scripts/build-plugin.mjs` runs a bare Vite build with no Solid plugin and no JSX
transform, so JSX would not have compiled. `plugins/rollbar/package.json` has no `solid-js`
dependency either. The option was never on the table, and nothing in the code or the review record
says so — which is how a workaround becomes an apparent convention.

## Why it matters

**It contradicts the argument the frame design was sold on.** The reason the shell could stay on
Solid without constraining anyone was: inside its own frame a plugin bundles whatever framework it
likes, nothing is shared, so nothing has to be shared correctly. The reference plugin now
demonstrates the opposite. An author reading it concludes framework support is theoretical.

**It costs correctness, not just typing.** Hand-rolled DOM means hand-rolled state
synchronisation — the frame holds a `ViewState` and reconciles it into elements by hand. That is
where stale-render bugs live, and every plugin that copies the pattern inherits the same class of
bug.

## Fix, part one: let frames use Solid

1. Add `vite-plugin-solid` to the **client** build in `build-plugin.mjs`, and `solid-js` to the
   plugin's dependencies. The workspace catalog already pins `solid-js: "^1.9.13"`, so version
   drift is not a concern.
2. Rewrite the Rollbar frame in Solid. Roughly 350 lines; `frame/model.ts` already holds the state
   model and does not change.
3. Expect the bundle to grow from ~29 KB unminified by around 10 KB. Irrelevant — bundles are
   content-addressed and cached per hash.

**One comment to write while doing it.** `pnpm-workspace.yaml` warns that duplicate `solid-js`
means two reactive graphs. That is true and important *in the shell*, and explicitly not a problem
here: a frame is a separate realm with its own document and its own bundle, which is the entire
point of the sandbox. Say so at the point where the plugin declares the dependency, or someone will
correctly-looking "fix" it back.

**One decision to make.** Whether the build preset ships Solid support specifically, or stays
framework-agnostic with Solid as the ergonomic default. Prefer the second: if the preset only ever
supports Solid, we have quietly recreated the constraint the frames were built to remove. Support
Solid well, keep the config overridable, and say in the authoring guidance that other frameworks
work.

## Fix, part two: give frames the UI building blocks

**Direction, decided:** third-party plugins should be able to import acorn's shared Solid UI
components. The goal is that a plugin author gets buttons, fields, badges, pickers and the diff
model as building blocks rather than rebuilding them, so a plugin looks and behaves like the rest
of the app without effort.

**Today they can import `@acorn/plugin-api/ui`, and that is acceptable.** It is a workspace
dependency, so this works for in-repo plugins and not yet for genuinely external ones. That is a
known, accepted intermediate state: the components will be extracted into a separately published
dependency later, and plugins written against `@acorn/plugin-api/ui` now are written against the
right surface — only the package name will change.

So: **use them.** Do not hand-roll a button in a frame because the packaging is unfinished.

### Why this works at all

Two earlier decisions make it safe, and both are worth knowing before anyone worries about it:

- **Frames are separate realms.** A second Solid instance inside a frame is not the failure mode
  the shell guards against — different document, different bundle, no shared reactive graph. The
  hazard only exists when two Solids share one realm.
- **`ui/` is enforced-pure.** The boundaries test requires `client-core/src/ui/` to be props-in,
  DOM-out with no data-layer imports — the split that moved `RepoPicker` and friends out. That rule
  was written for contract hygiene, and it is what makes these components safe to drop into a frame
  with no query client, no shell context and no host services. A component that had grown a fetch
  would not work here at all.

### The one real gap: styles

The components emit class names — `ui-btn`, `ui-field`, `ui-badge` — and the CSS that implements
them lives in `client-core/src/styles/`, not with the components. A frame today receives the
appearance **tokens** over the bridge, but no stylesheet, so an imported `Button` renders as
unstyled markup with the right class on it.

That needs solving as part of this work, and the options are:

- **Serve the primitives stylesheet at the frame origin** and link it from the generated document,
  alongside the tokens. Simplest, keeps one copy, and the frame document is host-generated so the
  plugin cannot interfere with it.
- **Let the plugin import the CSS** so its bundler inlines it. Self-contained, but every plugin
  carries a copy and they drift as the design system changes.

Prefer the first. It also settles a question the earlier design left open — a CSS primitive kit for
foreign-framework frames — by making the real stylesheet the kit, rather than maintaining a second
vocabulary that has to be kept in sync.

## Done when

- [x] A frame can be written in Solid with JSX, and the Rollbar frame is.
- [x] A frame can import `@acorn/plugin-api/ui` and the components render styled, in both appearance
  axes.
- [x] The intermediate packaging state is written down where an author will see it: these imports are
  correct now and the package name will change when the UI kit is extracted.
- [x] The build preset does not make Solid the only option.
