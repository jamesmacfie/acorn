# Layout: every pane as a host-owned layout filled with a component tree

Status: proposal, 2026-08-28. Nothing here has started.

This folder is the plan for changing how acorn draws plugin UI. Today a first-party plugin draws
with Solid components and its own CSS inside the shell, and a loaded plugin draws inside a
sandboxed iframe. After this programme, every pane is one of a small set of layouts the host owns,
each region of a layout is filled with a tree of components from a closed kit, first-party and
third-party plugins write against the same component API, plugins can extend each other's UI and
behaviour through five declared kinds of extension point, and keyboard navigation comes from the
tree rather than from whichever developer remembered to add it.

The desktop app must work at the end of this as it does now, with small and acceptable visual
differences. The programme builds desktop only. A mobile PWA is next and a terminal renderer is
last, and no phase here may make either harder.

The documents in this folder came out of one long design conversation. Three published pages are
the origin record and this folder supersedes them:
[Frames inside frames](https://claude.ai/code/artifact/ce3f68b4-b458-43d3-8839-ddcc0e6c2440),
[Five ways in](https://claude.ai/code/artifact/921d76b0-6b4c-46e5-bac8-3b423a0e4d1d), and
[Every pane as a tree](https://claude.ai/code/artifact/0e9a6302-fe32-4303-8536-bee5c1f3ff0d).
Where a page and this folder disagree, this folder wins. Where this folder and an owning doc under
`docs/` disagree after a phase ships, the owning doc wins.

## The goals, in the order they appeared

1. **The original question.** A plugin with a frame should be able to let other plugins put UI
   inside it, and the two should talk, with explicit typed messages, without weakening the
   security rules: code does not cross between plugins, the host mints every name, an owner
   consents in its manifest, and the trust prompt shows both sides.
2. **Extension is five kinds, not one.** Rows, annotations, remote trees, rectangles, and hooks.
   A survey of every plugin showed that "put my frame in your frame" covers a third of what
   people will ask for. The rest is facts pinned to items, UI inside somebody else's list, and a
   turn in a decision before it happens.
3. **A closed kit with semantic props.** Every component a plugin may use is in one list, its
   props are role tokens (`tone`, `space`, `emphasis`) and never `class` or `style`, and each
   component has a defined rendering on a host with no pixels.
4. **Layouts are the host's.** A pane declares which of six layouts it is and fills the regions.
   Responsiveness is paid once per layout, not once per pane, and a terminal projection is a
   property of the layout.
5. **Focus and keys for free.** The kit decides what is focusable, the host owns selection and
   scroll state per collection, keys become intents before anything sees them, and the keymap is
   one engine with a DOM adapter now and a terminal adapter later.
6. **Plugins as interceptors.** Observe, transform, or veto a decision before it happens. That is
   a hook, not an event, and it is a different contract from the one in
   [docs/future/events.md](../events.md), which stays as it is.

## Decisions taken

These were decided with the owner and are settled. A phase file may not reopen them.

| Decision | Why | What it forecloses |
| --- | --- | --- |
| First-party plugins render **directly in the shell** against the same layout and kit API; third-party plugins render through a **remote root**. One component API, two render paths. | Keeps the desktop's performance profile and lets each first-party pane move without a sandbox hop. Slots work across both paths because both produce the same tree. | First-party and third-party are not the same runtime. Making a first-party plugin loadable is a later, separate move per plugin. |
| The keymap engine is **`@opentui/keymap`**, adopted outright. | Host-agnostic core with a DOM adapter and a terminal adapter already written; focus-scoped layers, sequences, a command catalog, and diagnostics. Writing our own would reproduce it. | We take a dependency on its layer and command model. Our `KeybindingScope` maps onto its layers rather than the reverse. |
| Third-party remote-tree code runs in a **Web Worker** on desktop, one per plugin bundle. | No DOM at all, lighter than an iframe, and the bridge is already message-based so it is a transport swap. | The hidden-iframe path is not built for trees. The iframe survives only as a rectangle for surfaces that own pixels. |
| Phases land **one after another with nothing released between them**. | No backward compatibility inside the programme, so no shims, no dual paths, no feature flags for old and new. | Comprehensive testing happens once, at the end. Each phase still keeps `pnpm lint` and `pnpm test` green. |
| **Desktop only.** PWA next, terminal last. | Scope. | Nothing. Every phase carries a "doors left open" section that says what it must not do for the two later hosts. |

## The admission rule

A kit node or a layout earns a place only if all four hold:

1. Two or more plugins need it, or one first-party pane cannot be expressed without it.
2. It has a defined rendering at 80 columns by 24 rows in monochrome, written down, even though
   the terminal host is not built here. If that sentence cannot be written, the thing is a
   rectangle, not a node.
3. Its props are semantic. Tone, emphasis, size in three steps, grouping. Never a pixel, a colour,
   a class, or a style.
4. If it is an extension kind, one host-owned sentence describes it in the trust prompt, and a
   person would knowingly accept that sentence.

[refused.md](./refused.md) holds what failed the rule and why, so the same argument is not had
twice.

## The files

Supporting documents, readable in any order:

| File | What it holds |
| --- | --- |
| [01-why.md](./01-why.md) | The discussion and rationale, condensed. Read this first if you were not in the room. |
| [02-survey.md](./02-survey.md) | How every plugin draws itself today, what it uses from the kit, and what it becomes. |
| [03-extension-kinds.md](./03-extension-kinds.md) | Rows, annotations, remote, rectangle, hook. The four shared rules and the manifest. |
| [04-kit.md](./04-kit.md) | The closed component set, role tokens, the per-host support matrix, and the tests that hold it. |
| [05-layouts.md](./05-layouts.md) | The six layouts, their regions, how they arbitrate contributors, and how they project. |
| [06-remote-tree.md](./06-remote-tree.md) | The wire format, the worker sandbox, validation, slots as nodes, and the two render paths. |
| [07-focus-and-keys.md](./07-focus-and-keys.md) | Focus roles, host-owned collection state, intents, and the keymap layers. |
| [08-hooks.md](./08-hooks.md) | The hook contract, how it differs from events, chain rules, and the first hooks to open. |
| [09-doors-left-open.md](./09-doors-left-open.md) | What the PWA and the terminal need from every phase, and the list of things never to do. |
| [refused.md](./refused.md) | What was considered and refused, with the argument. |
| [docs-migration.md](./docs-migration.md) | Every document under `docs/` that changes, which phase changes it, and how. |

## The phases

| Phase | File | What it delivers | What it unblocks |
| --- | --- | --- | --- |
| 0 ✅ | [phase-0-kit-and-tokens.md](./phase-0-kit-and-tokens.md) | The closed kit: node set frozen, nine gap nodes added, role tokens, support matrix, no `class` or `style` on any node | Everything. Layouts and trees are made of these nodes. |
| 1 | [phase-1-layouts.md](./phase-1-layouts.md) | Six host-owned layouts; a pane declares one and fills regions | Focus groups, slots in regions, responsive and terminal projections |
| 2 | [phase-2-focus-and-keymap.md](./phase-2-focus-and-keymap.md) | `@opentui/keymap` over the command registry, intents, host-owned collection state, focus roles on the kit | Keyboard navigation and ARIA for every pane at once |
| 3 | [phase-3-remote-root-and-worker.md](./phase-3-remote-root-and-worker.md) | The tree protocol, the worker sandbox, the host renderer, `mountTree`, proven on the changes tool card | Third-party UI inside first-party surfaces |
| 4 | [phase-4-extension-kinds.md](./phase-4-extension-kinds.md) | `kind` on extension points; annotations, remote slots, rectangle slots, hooks; the trust copy; the developer view | Plugins extending plugins, the original goal |
| 5 | [phase-5-loaded-four.md](./phase-5-loaded-four.md) | http, database, linear, rollbar move from iframe to remote root | The first proof on real plugins, with their CSS deleted |
| 6 | [phase-6-small-compiled-panes.md](./phase-6-small-compiled-panes.md) | context, memory, notes, changes, docker, workflows settings, onboarding as layouts and trees | Memory and changes stop being first-party-only |
| 7 | [phase-7-github.md](./phase-7-github.md) | The PR pane, browse, list, ref panel, and importer as layouts and trees | The largest regular pane proves the layouts hold |
| 8 | [phase-8-agents.md](./phase-8-agents.md) | The transcript as a timeline of slots, the composer with slots, the sidebar, Agent Center | The pane the whole exercise pays for |
| 9 | [phase-9-cleanup-and-docs.md](./phase-9-cleanup-and-docs.md) | Deleting the old paths, executing the docs migration, the full test pass | Done |

## The order of work

The first five phases are strictly ordered and each depends on the one before:

- The kit (0) is the vocabulary. Nothing can be written in it until it exists.
- Layouts (1) are made of kit nodes and are where regions, and therefore focus groups and slots,
  live.
- Focus and keys (2) attach to kit node roles and to layout regions, so both must exist. It comes
  before the remote root because a remote tree must produce the same focus behaviour as a direct
  one, and the cheapest way to guarantee that is for the behaviour to already live in the host.
- The remote root (3) renders kit nodes into layouts and hands intents back. It is proven on one
  slot, the agents tool card, before anything else depends on it.
- Extension kinds (4) need slots, which need the remote root, and hooks, which are independent
  but are gathered here so the manifest changes land together.

Phases 5 through 8 move panes and are independent of each other, with two constraints: the loaded
four (5) go first because they are already nearly trees and prove the remote path on real plugins,
and agents (8) goes last because it is the largest and most performance-sensitive pane and every
mechanism it needs should have been exercised elsewhere first. Phase 9 is cleanup and can only
follow everything.

## How to work a phase

Each phase file has the same sections: goal, why now, scope, design detail, code touched, tests,
docs owed, doors left open, done when, verify before building. Two rules from the repo's own
conventions apply throughout:

- **Verify before building.** File and line references were checked against the tree on
  2026-08-28. Paths rot. Run the verify list at the end of each phase file before writing code.
- **Update the owning doc in the same change.** [docs-migration.md](./docs-migration.md) says
  which document owns each behaviour afterwards. A phase is not done until that document says
  the new true thing, and phase 9 is where the remaining rewrites happen.

## What this folder is not

- It does not build the PWA or the terminal. It keeps them possible.
- It does not redesign events. [docs/future/events.md](../events.md) is untouched; hooks sit
  in front of a decision and events come after it.
- It does not change the node side of plugins except to add `ctx.hooks` and to convert the five
  existing single-slot seams to it.
- It does not schedule anything. This is ordering and content, not dates.
