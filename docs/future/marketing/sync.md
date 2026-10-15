# Keeping the site in sync

Date: October 15, 2026. Part of [the website programme](./README.md).

This page lists every way the site stays true to the code: what it reads from source at build time,
what it commits and checks, and how a hand-written page finds out its sources changed. Read it before
you add a generated page, a specimen, or a page that describes behavior.

The site describes a product that changes every day. A docs site that drifts is worse than none,
because it teaches the wrong thing with authority. Three rules keep it honest.

## Rule 1: read from source at build time

If the site build can compute something from the repository, it does, and nothing is committed. A
value that's computed on every build can't go stale. These are read at build time:

| What | Source |
| --- | --- |
| The plugin manifest JSON Schema, served at `/schemas/acorn-plugin.schema.json` | `packages/plugin-types/acorn-plugin.schema.json`, itself held to `packages/protocol/src/plugin/contract.ts` by `packages/plugin-types/src/pluginSchema.test.ts` |
| The device config schema | `packages/plugin-types/acorn-device.schema.json` |
| The command line's output schemas | `apps/cli/schemas/resources-v1.schema.json` and `apps/cli/schemas/error-v1.schema.json` |
| The manifest reference and the contribution field tables | The same JSON Schema, plus field descriptions [phase 15](./15-plugin-reference.md) adds to the contract |
| The plugin API major | `PLUGIN_API_MAJOR` in `packages/protocol/src/plugin/apiVersion.ts` |
| Limits, such as tool output bytes and bridge budgets | The constants `packages/node-core/src/server/agentTools/pluginAuthoring.ts` already imports for the `plugin_authoring` tool |
| The extension point catalogue | `PUBLIC_EXTENSION_POINTS` in `packages/protocol/src/chrome/publicExtensionPoints.ts` |
| Core facets a manifest can grant | `NODE_CORE_FACETS` in `packages/node-core/src/server/plugins/coreFacets.ts` |
| The Node context and bridge references | The published declarations: `acorn-plugin-types` and `packages/plugin-sdk/src/public.ts` |
| The kit catalogue: nodes, host support, losses, focus roles, and role enums | `NODE_SUPPORT`, `NODE_FOCUS`, and the role tables in `packages/client-core/src/kit/tokens/` |
| The CSS that styles specimens | `packages/client-core/src/infra/styles/` and each feature's own stylesheet |
| The theme and style pack list | `packages/client-core/src/infra/styles/tokens-theme.css` and the style pack files |
| Icon names, and which have a terminal glyph | `packages/client-core/src/kit/tokens/iconNodes.ts` and `apps/tui/src/kit/glyphs.ts` (read as a file, not imported) |

The `plugin_authoring` agent tool already derives most of this vocabulary from the same sources, so an
agent writing a plugin and a person reading the site see the same facts. Phase 15 moves the shared
derivation into one function both call, rather than writing it twice.

The site never copies one of these values into prose. A page that needs the plugin API major uses the
`<ApiMajor />` component. `packages/plugin-types/README.md` says the host speaks major 4 while the
constant says 5, which is the drift this rule prevents.

## Rule 2: commit what the build can't produce, and test it

Some outputs need a runtime the site build doesn't have: a DOM host in jsdom, the terminal renderer, a
running app, or the network. Those are committed, and a test regenerates them and fails on any
difference. This is the pattern `packages/plugin-types/src/pluginSchema.test.ts` already uses.

| What | Generator | Check |
| --- | --- | --- |
| Component specimens: desktop HTML and terminal cells | [Phase 3](./03-specimens.md) | A test regenerates every specimen and compares bytes. A kit change that moves markup fails until someone regenerates and reviews the pictures. |
| Shell snapshots: whole desktop and terminal windows | [Phase 7](./07-shell-snapshots.md), a maintainer task against a running app | No byte check, because a running app isn't deterministic enough. Each snapshot records the commit it came from, and the staleness report below lists snapshots older than the last change to the shell or the stylesheets. |
| GitHub stars and release assets | [Phase 10](./10-download-and-changelog.md), at build | Fetched at build. A committed `apps/site/src/data/github.json` (new) holds the last good answer, and the build uses it when the API fails. |
| The changelog | Hand-written data in phase 10, read from GitHub in [phase 21](./21-changelog-from-github.md) | A schema check on the data file. |

## Rule 3: written pages name their sources

Most of the site is written by people: the landing page, feature pages, tutorials, guides, and the
explanation on every reference page. Nothing can generate those, so the site makes drift visible
instead.

### The frontmatter

Every page that describes behavior carries two fields:

```yaml
sources:
  - docs/database.md
  - docs/database/pane.md
checked: 3f9a2c1
```

`sources` lists the internal docs and source files the page was written from, as repository paths.
[The site map](./site-map.md) gives each page's starting list. `checked` is the commit at which someone
last confirmed the page matches its sources.

A content collection schema in phase 2 makes both fields required on every docs page and every feature
page, so a page can't ship without them. A test checks that every path in `sources` exists.

### The staleness report

`pnpm --filter @acorn/site stale` (phase 4) runs `git log <checked>..HEAD -- <sources>` for every page
and prints each page whose sources changed, with the commits that changed them. To clear a page, read
those commits, update the page if behavior changed, and set `checked` to the current commit.

The report runs in CI on every pull request that touches `docs/` or `apps/site/`. It writes a job
summary and doesn't fail the build, because a source edit that changes no behavior shouldn't block a
merge. Before a release, the report must be empty. [Phase 20](./20-launch.md) adds that to the
release checklist.

### The rule for internal docs

When a change edits an internal doc, the author runs the report and fixes the public pages it lists in
the same pull request, or says in the description why they don't need it. Phase 4 adds this rule to
[Write and maintain docs](../../writing-docs.md) and a line to `AGENTS.md`, because agents write most
doc changes here.

## Coverage checks

Generation keeps facts current, but it can't notice a missing page. These tests fail when something
exists in code and not on the site:

- Every top-level manifest key and every `contributions` key has a reference page with at least one
  example. Every example manifest on the site parses with the real Zod contract,
  `pluginManifestShape`, not the JSON Schema, because the JSON Schema can't express the contract's
  cross-field rules.
- Every kit node has a component page and at least one specimen.
- Every public extension point has an entry, with an example, on the extension points page.
- Every Settings page the app registers is covered by a settings docs page, through a `covers` list in
  that page's frontmatter.
- Every code block marked `ts` or `js` in the plugin docs type-checks against the current packages,
  the way `references/opentui/packages/web/scripts/verify-doc-examples.ts` does.
- Every example plugin under `examples/plugins/` builds, installs into the Node testkit, and passes its
  own test.

## Where each check runs

All of these join one CI job, `site`, which [phase 2](./02-scaffold.md) creates and each later phase
extends. It runs on any pull request that touches `apps/site/`, `docs/`, `packages/protocol/`,
`packages/client-core/src/kit/`, `packages/client-core/src/infra/styles/`, `packages/plugin-sdk/`,
`packages/plugin-types/`, `apps/tui/src/kit/`, or `examples/`. A kit or contract change outside the
site still runs the site's checks, which is the point.
