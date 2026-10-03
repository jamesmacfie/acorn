> **Completed 2026-10-04** by the "Phase 6 Plugin docs" task.
>
> **What landed:** All 22 plugin docs were checked against the code, restyled, and cut to 200 lines
> or fewer. `plugins.md`, `plugin-authoring.md`, `extensibility.md`, and `first-party-plugins.md` are
> landing pages over 58 topic pages in folders of the same names, and `plugins.md` keeps every anchor
> it had. A script moved about 530 source citations to the topic pages, so the citation allowlist is
> empty. The length report in `tools/arch/docCitations.test.ts` is a hard gate, with `docs/README.md`
> as its one named exception, because the index lists every page.
>
> **Deviations:** (1) More pages than the plan named: `docs/plugins/` has 35 pages, and
> `docs/plugin-authoring/` has 19. `the-manifest.md` split into the manifest, contributions,
> permissions, settings pages, UI contributions, extensions, harnesses, and custom agents.
> `the-node-half.md` split into the node half, telemetry, testing, storage, the client half, and the
> bridge. (2) `descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md` is `plugins/ui-tiers.md`.
> Its old anchors stay on `plugins.md`, and every doc link to it was repointed. (3)
> `loaded-plugin-migration.md` is a short pointer page, not deleted, because this doc's own table
> links to it and I couldn't edit the body. Its text is in Git history, and its open items moved to
> `docs/future/compiled-tier.md` § Open items from the loaded-plugin migrations. (4) "Where this is
> going" moved to `docs/future/ecosystem/where-this-is-going.md`, indexed in that README. (5) The
> per-plugin terminal losses table moved from `first-party-plugins.md` to
> `first-party-plugins/terminal.md`, and the examples appendix to `first-party-plugins/examples.md`.
> (6) Code won over the docs in these places: `PLUGIN_API_MAJOR` is `3`, not `2`. `extensionPoints`
> and `extensions` cap at 16, not 4 and 8. There are 26 contribution keys, not 23, and `inline` is a
> frame target. `icon` is `{ d, color? }`, not a bare string. `agent-tool-provenance` is a core token
> the docs never named. `HOST_OWNED_CAPABILITY_IDS` holds only `agents.harnessRegistry`, and I fixed
> the stale comment in `permissions.ts`. Frames get five shell channels, not four. A frame may
> subscribe to another plugin's declared verb. The builder doesn't write `requires`. Loaded plugins do
> get `providers.model`. `docker:stats-beside` and `core:storage` were missing from the remote point
> table. The plugin scheme also serves `/worker.html` and `/worker-host.js`. `--remote` isn't a
> scaffold flag. The bundled roster has seven packages, not four. `browser` was missing from the
> first-party audit, so I added reason G, a native dependency. Four first-party events were missing
> from the event table. (7) The Node refuses loaded plugins below
> `>=22.23.2 <23 || >=24.18.1 <25 || >=26.5.1 <27`, which the docs never said. The authoring and
> install pages say so.
>
> **For later phases:** `packages/create-acorn-plugin/index.test.ts` reads doc files. It pulls the
> fenced examples under `` ## `acorn-plugin.json` `` (and the other file headings) in
> `docs/plugin-authoring/complete-example.md`, and under `## Add task annotations` in
> `docs/plugin-authoring/extensions.md`. Rename those headings and the test breaks. I pointed it at the
> moved pages. The throwaway scripts I used, not committed, did two jobs: they rewrote
> `docs/<landing>.md § Heading` citations to whichever topic page in `docs/plugins/` or
> `docs/plugin-authoring/` owns the longest matching heading, and they repointed doc links whose
> fragment moved. Seven citations needed hand fixes, mostly ones whose heading wraps onto a JSX comment
> line with no `*`, which the checker can't join. Keep the heading on the `§` line. I checked every
> manifest example on these pages against the real parser with a throwaway test: 28 manifests parse
> with no unrecognized keys. I ran the scaffold, and it wrote five files with `"apiVersion": "3"`.
> The scaffold suite's two node-half tests fail on this machine's Node 24.11.0, below the supported
> range, and pass the other 13. `tools/arch/tomlSecurity.test.ts` timed out once under load and passed
> alone. I ran `pnpm lint`, the arch suite, and the scaffold suite, not the other package suites,
> because the source edits are comments only. I didn't run `pnpm dev:agent`, so UI labels such as
> **Settings > Plugins > Rail and surfaces** were checked against source strings only.

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
