# Phase 03: Minify production JavaScript without weakening graph checks

Date: October 9, 2026. Status: planned. Depends on: phase 01.
Source baseline: `989b069c389df6143b90ffb9889dfeaae5db6010`.

Minify the Node service and loaded-plugin production bundles. Keep budget accounting independent
of emitted import formatting, and retain useful diagnostics for packaged failures.

## Starting point and owners

`apps/node/vite.config.ts` sets `minify: false`. `apps/node/scripts/build-plugin.mjs` disables
minification for node and client halves. The helper and terminal builds already use Oxc; the desktop
renderer already receives production minification.

`apps/node/scripts/check-service-budget.mjs` discovers imports with a regular expression that expects
unminified line formatting. A minifier can invalidate its closure without changing runtime imports.
`apps/node/scripts/measure-service-graph.mjs` reads the bundler's graph and emitted chunk bytes.

On October 8, a temporary Oxc build reduced the Node static graph from 3,179,449 B to 1,697,866 B.
This measures bytes on one snapshot; it does not establish a startup-time improvement.

## Implementation

1. Emit service graph metadata from the production build: entrypoints, static and dynamic chunk
   edges, external imports, source module IDs, and final emitted sizes. Keep it outside shipped code
   unless phase 01's numeric report deliberately includes a bounded subset.
2. Make the budget checker consume the graph and stat the final assets. Validate that the graph
   describes this build; reject missing entries, missing edges, and stale metadata. Preserve external
   import reporting and distinguish imports loaded on first use. Keep a meaningful floor.
3. Turn on Oxc production minification for service entrypoints and loaded-plugin node/client bundles.
   Preserve dynamic imports, worker URLs, migrations, required assets, and runtime process.env reads.
   Do not minify third-party executables or blindly rewrite installed dependency files.
4. Decide and verify stack diagnostics before handoff. Keep readable function names where required;
   provide a documented matching-build source-map workflow. Keep maps and source contents out of
   installers unless deliberately required. Uploading maps to a vendor needs configured release
   credentials and its own verified CI step; do not add automatic uploads as a size fix.
5. Remeasure each graph, packaged bytes, and cold/warm startup. Rebaseline the byte ceiling on the
   same build mode and platform; lower it after the cut. Preserve architectural lazy-import checks
   so minification cannot hide an eager dependency regression.

Maintain one graph implementation for budget and diagnostic consumers where practical. Avoid two
different parsers for the same output. Keep production output and development diagnostics explicit.

## Verification and completion

Graph fixtures must demonstrate identical closure semantics for formatted and minified output,
shared static chunks, lazy-only chunks, re-exports, side-effect imports, external packages, and stale
metadata. A lazy heavy module becoming static must still be visible and counted.

Run `pnpm --filter @acorn/node build` and `pnpm --filter @acorn/desktop build`. Their graph and
runtime-syntax checks must pass. Run `pnpm lint`, `pnpm test --filter=@acorn/node`, changed loaded-plugin
package suites, `pnpm --filter @acorn/desktop test`, and `pnpm --filter @acorn/arch-tests test`.

Verify the extracted service, MCP, loop hook, workers, and loaded packages outside the checkout.
Trigger a controlled packaged error and locate its owning source with the documented diagnostics.
Complete with before-and-after graph and installer reports, boot timings, and no assertion that
byte savings alone prove faster startup. Update [startup budgets](../../frontend/startup-budget.md)
and [profiling](../../local-development/profiling.md).

## Recheck before implementation

Recheck Vite's graph hooks and Oxc options in the installed versions. If minification changes a
runtime contract or diagnostics cannot identify the owner of an error, fix that before lowering
budgets. Do not exempt chunks or externalize dependencies merely to make the number pass.
