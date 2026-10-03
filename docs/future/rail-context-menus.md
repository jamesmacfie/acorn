# Desktop rail context menus

Date: 2026-10-03  
Status: Approved for implementation on an isolated branch. Integration awaits review of the implementation summary.

## Problem and outcome

Acorn's desktop source icons on the left rail and task pane icons on the right rail need discoverable
context menus. Reuse the shared `Menu` and context menu contribution system for core and plugin
actions, including compiled and loaded plugins. Preserve plugin API major 3 and terminal behavior.

## Scope

Cover the default source rail and pane switcher, plus an optional host menu door for replacement
providers, including remote trees in workers. Do not intercept plugin frames, browser pages, editors,
terminals, or arbitrary replacement-provider markup. Do not add TUI context menus, nested menus,
hide-source preferences, database migrations, broad rail redesign, or plugin business features.

## User experience

Right-click an icon to open a menu at the pointer without selecting, opening, changing task, or
starting drag. Another menu replaces it. Use kit typography, role tokens, focus behavior,
separators, viewport clamping, and native child webview overlay composition. Escape and outside
click dismiss. Selection follows shared `Menu` behavior. Focus returns to the icon if it exists.
Shift+F10 and the context-menu key open beside the focused icon. Right-click cannot be the sole path
to an action: core verbs keep their command or visible control alternatives; plugin rows have a
keyboard door.

Default source menu: Open. Default pane menu: Open, Open beside, Pin or Unpin, and Close when allowed.
Use existing layout verbs and respect pinned panes, unavailable panes, archived tasks, and the
last-pane invariant. Plugin actions supplement host actions. Render no empty popup.

## Shared component and ownership

Reuse `packages/client-core/src/kit/components/overlays/Menu.tsx`, `ContextMenuHost`, and
`ContextMenuItems`. Menu primitives stay free of product registries; `RailTab` stays presentation
only. Host modules construct targets and resolve actions. The host provides icon identity, plugin
owner, selected Node, project/workspace context where relevant, and task context for pane actions.
It owns navigation, layout dispatch, authorization, availability, and lifecycle. Action definitions
do not carry pointer geometry.

## Plugin contract

Add `rail.source` and `rail.pane` to `contributions.contextMenus`, preserving `task.row` and
`item.row` semantics and cross-plugin extension. Require a narrow `surface` reference for rail
descriptors. Validate that it names a source or task pane owned by the declaring plugin at Node
manifest parse and client registration. IDs may differ from the plugin ID. Compiled registration
uses host-known registration ownership, never a caller-supplied owner.

Keep bounded descriptors, stable order, host-minted loaded action IDs, route confinement, declared
surface checks, and closed action verbs. Assess the eight-row cap against plugins with more than
eight rail surfaces; increase it additively and keep it bounded if necessary. Node actions stay in
their own `/v1/p/<id>/` namespace. Send only bounded, serializable, host-derived rail context; row
request bodies keep their previous shape. A source icon supplies no sticky active task or unrelated
list item. Pane actions use the clicked task and pane.

Node, task, source or pane registration, plugin runtime, and accepted bundle changes invalidate an
open menu or safely refuse execution. Disabling, updating, or unloading removes rows and prevents
stale closures. Demonstrate a loaded plugin with source and pane menus and executable behavior;
support and test compiled registration too.

## Replacement providers

Add an optional host-owned invocation method to `rail` and `pane.switcher` props. For worker trees,
pass only a surface ID and point; the host validates the ID against its available icons. Providers
cannot forge owners, routes, or executable callbacks across the worker boundary. Existing providers
continue unchanged. Terminal behavior stays explicit and harmless.

## Compatibility

Keep `PLUGIN_API_MAJOR` at 3, add optional fields and methods, and preserve published names and
request shapes. No storage reset or migration. Older Nodes reject new location enum values; older
desktop clients may reject new rows. Document the release requirement within major 3 and retain
contained version-skew warnings. Update the published schema and declaration/facade surfaces where
needed, independently of plugin package versions.

## Verification and delivery

Before implementation, inspect the architecture, frontend, conventions, plugin map and references;
trace Node manifest through protocol, broker, client registration and availability to desktop UI.
Confirm host verbs, layout invariants, native overlay selectors, generated schema commands and tests.

Add focused contract, ownership, dispatch-context, lifecycle, and renderer behavior tests. Run
`pnpm lint` and relevant package and architecture tests; use `pnpm test` for the whole suite. Verify
in a real Tauri window using `pnpm dev:agent -- --session <unique-name>` and the
`dev:agent:ui` snapshot/click/fill/screenshot workflow; inspect images and stop the session. Run
the isolated PTY driver only if terminal behavior changes. Commit implementation, this PRD,
documentation, schema, and tests on the isolated task branch. Report exact checks, graphical
evidence, risks, and unmet criteria. Do not merge, push, publish, or modify main or the parent
checkout. Integration requires explicit user instruction after review.

## Verification evidence

Evidence dated 2026-10-03 belongs in the task summary. Acceptance remains open until graphical
verification and the required gates have completed.

## Verify before building

Confirm cited paths against this checkout. Preserve the product requirements if a module moved.
