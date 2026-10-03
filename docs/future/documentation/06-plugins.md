# Phase 6: Plugin docs

Date: October 3, 2026. Status: proposed, not started. Part of the
[documentation overhaul](./README.md). Do [phase 1](./01-guardrails.md) first.

These pages describe the plugin system to two readers: developers changing host seams, and authors
writing a plugin. Third-party authors read them without the source open, so accuracy matters more
here than anywhere else.

## Docs in this phase

| Doc | Lines | Source citations |
| --- | --- | --- |
| [plugin-map.md](../../plugin-map.md) | 200 | 3 |
| [extensibility.md](../../extensibility.md) | 424 | 1 |
| [plugins.md](../../plugins.md) | 229 | 540 |
| `docs/plugins/` (9 pages) | 3,847 | 18 |
| [plugin-authoring.md](../../plugin-authoring.md) | 144 | 45 |
| `docs/plugin-authoring/` (6 pages) | 1,795 | 5 |
| [contribution-kinds.md](../../contribution-kinds.md) | 160 | 9 |
| [first-party-plugins.md](../../first-party-plugins.md) | 366 | 2 |
| [loaded-plugin-migration.md](../../loaded-plugin-migration.md) | 330 | 2 |

## Known problems

### plugins.md and docs/plugins/

`plugins.md` is the most-cited doc in the repository, with 540 source citations, and is a landing
page with 29 anchors. Its pages in `docs/plugins/` came from an earlier split, and most of them are
still too long:

| Page | Lines |
| --- | --- |
| `activation.md` | 639 |
| `client-authoring-and-the-ui-kit.md` | 514 |
| `cooperative-extension-points.md` | 487 |
| `descriptors.md` | 457 |
| `forward-compatibility.md` | 374 |
| `package-shape.md` | 355 |
| `node-side-extension-points.md` | 346 |
| `descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md` | 338 |
| `frames.md` | 337 |

`activation.md` holds eight sections that `plugins.md` lists separately: activation, loaded plugins,
the dev loop, approval-mediated install, development mode, teaching the agent, the client half, and
device-held plugins. Give each its own page. Rename
`descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md` to a short topic name, and keep
the old path's anchors on the landing page.

Never remove an anchor from `plugins.md`. Phase 1's check will list the source comments that depend
on each one.

### plugin-authoring/

`the-manifest.md` came out of an earlier split as one 729-line section. Split it by manifest block.
`the-node-half.md` runs 498 lines. Check every manifest field against the schema in
`packages/plugin-types` and every example against the scaffold. An author copies these examples
verbatim, so run each one.

### extensibility.md

This is the reasoning page, so design argument belongs here. "Where this is going" is proposal
material. Move it to `docs/future/ecosystem/`. Check that each stated constraint is still true.

### first-party-plugins.md

"The honest asterisk" and "Rules of thumb" are judgment calls. Keep them, in plain words. Check the
plugin list against the `plugins/` folder and the bundled roster.

### loaded-plugin-migration.md

This is a history record, not a reference. It has sections titled "Pick up work here" and "The
Linear-migration review — closed". Move what's still open to `docs/future/compiled-tier.md`, then
delete the page and leave a line in the docs index that it lives in Git history.

### contribution-kinds.md

A test enforces the table. Restyle the prose around it. Don't reorder the table without reading the
test first.

## Done means

- Each doc in the table follows the [house style](./style.md) and is 200 lines or shorter.
- Every manifest field and example matches `packages/plugin-types` and the scaffold.
- `plugins.md` keeps every anchor that source cites.
- Phase 1's length report becomes a hard limit in `pnpm --filter @acorn/arch-tests test`.

## Verify before you start

- Find the test that enforces `contribution-kinds.md` before you edit that page.
- Build a plugin from the scaffold with the steps in
  [start from the scaffold](../../plugin-authoring/start-from-the-scaffold.md), and confirm each
  step.
