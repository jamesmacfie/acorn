# Phase 6: readable stacks

Date: October 26, 2026, from the October 17, 2026 plan. Status: done. Depends on
[phase 4](./04-ship-the-dsn-in-release-builds.md).

## Completion note

Landed on October 27, 2026.

What landed:

- `build-desktop.yml` declares an optional `SENTRY_AUTH_TOKEN` secret, and `ci.yml` passes it in.
  The bundle job sets `ACORN_RELEASE_SOURCEMAPS=1` for a `v*` tag when the token, `vars.SENTRY_ORG`,
  and `vars.SENTRY_PROJECT` are all set. Otherwise it's empty, nothing builds maps, and the upload
  step is skipped. The flag is a yes or no. The token reaches only the upload step.
- With the flag, the renderer (`vite.config.ts`) and the helper (`vite.helper.config.ts`) write hidden
  maps. `scripts/bundled-plugins.mjs` passes `--sourcemap` to the plugin bundler, and
  `stage.mjs` copies the Node service's maps into `dist/helper`.
- **Upload source maps to Sentry** runs right after **Build the bundle inputs**, so the boot test
  and the Rust tests run against the injected bytes that ship. It runs `npx @sentry/cli@3.8.2`. It
  injects debug IDs into `helper`, `client`, and `bundled-plugins` (not `node_modules`), uploads
  each folder, then deletes every map.
- `verifyResources` in `bundle-inventory.mjs` fails the bundle check on any `.map` file in the
  packaged app, on all three OSes.
- The exporter calls a packaged Node frame by its uploaded name (`parseStack` in
  `plugins/sentry-telemetry/src/server/stack.ts`), and every error event carries `dist` beside its
  release.
- Docs: a section named "Readable stacks" in `docs/integrations/sentry/the-acorn-teams-dsn.md`, one
  sentence in `docs/integrations/sentry.md`, and corrections to `docs/local-development/packaged-stacks.md`
  and `docs/shell/packaging.md`, which said no build uploads maps.

Decisions and deviations:

- The phase assumed debug IDs alone would match frames to maps. They don't here. Sentry reads debug
  IDs from the event's `debug_meta`, which an SDK fills from a global the injected snippet sets in
  each realm. Our exporter builds its own events in its own worker, so it can't see the service's,
  the plugins', or the renderer's globals. Frames match by release, dist, and name instead. The debug
  IDs still pair each minified file with its map, because a hidden map has no `sourceMappingURL`
  comment to follow.
- Names: `app:///helper/<file>`, `app:///plugins/<id>/dist/<file>`, and `~/<file>` for the
  renderer. A packaged path depends on the install location, the data root, and the OS, so the
  exporter rewrites the tail it can recognize. A `.ts` path from a checkout keeps its real path.
- Dist is `<process.platform>-<process.arch>`, such as `darwin-arm64`. Each runner builds its own
  bytes. The repository has no `.gitattributes`, so Windows checks out CRLF. Entry files have fixed
  names (`service.js`, `node.js`), so without a dist the last runner's upload would answer for all
  four.
- The release is `acorn@` plus `apps/desktop/package.json`'s version. That's what Tauri reports as the
  app version, which the Node puts on each batch.
- The phase listed the plugin bundler and the renderer. I added the helper and the service too,
  because core's errors are most of what reaches the team. The bridge and the CLI send no telemetry
  of their own and stay out.
- `npx`, not `pnpm dlx`. `site.yml` notes that `pnpm dlx` fails on a dependency's build script.
- `inject` also writes its snippet into files with no map, such as `startup-guard.js`. It's wrapped in
  `try` and sets one global. The startup budgets run during `build`, before injection, so the snippet's
  few hundred bytes per file aren't counted.

What I checked:

- A local `pnpm --filter @acorn/desktop run build` without the flag staged no `.map` files. It
  stopped at the renderer startup budget, on `plugins/workflows/src/client/editor/draft.ts` and
  `stepFields.ts`. That failure is on the base commit: with the flag unset, the renderer config is
  unchanged.
- With the flag, staging and the renderer wrote 429 maps in `helper`, 567 in `client`, and 18 in
  `bundled-plugins`. The workflow's `inject` command ran clean. Then `check:runtime-syntax` passed on
  480 files, and `test:boot` passed 12 tests on the injected bytes.
- `verifyResources` against a copy of those trees reported 1,014 source maps.
- I didn't run `tauri build`, and no upload reached Sentry. That needs the token.
- The arch tests fail only on the old `workflows-gaps.md` links, as in phase 4.
- The site's stale check lists `start/install.mdx` and `download.astro`, which cite
  `docs/shell/packaging.md`. Neither teaches anything about maps, so neither changed.

What a person must set up:

1. In Sentry, create an organization auth token under **Settings** > **Auth Tokens**. Its `org:ci`
   scope covers release and source map uploads.
2. Add it as the repository secret `SENTRY_AUTH_TOKEN`.
3. Add the repository variables `SENTRY_ORG` and `SENTRY_PROJECT`, the slugs of the project that
   holds `ACORN_SENTRY_DSN`.
4. After the next tag build, throw a test error with both switches on. Check that the issue shows
   `.ts` file names and lines, and that `dist` matches the platform.

For later phases:

- A plugin's client bundle runs on its own `app-plugin://<sha256>/` origin and gets no uploaded name,
  so its frames stay minified.
- The standalone Node archive builds no maps and uploads none. It carries no DSN either, which is
  the README's open question.
- Bumping `@sentry/cli` is a one-line change in the upload step.

## Goal

An error thrown in a tag build shows original file names and line numbers in Sentry.

## Starting point

Every bundle is minified, so a stack in Sentry names minified functions. The plugin bundler already
writes hidden source maps on `--sourcemap`. Desktop renderer maps are unchecked.

## Steps

1. Add `SENTRY_AUTH_TOKEN` as a repository secret, and `SENTRY_ORG` and `SENTRY_PROJECT` as
   repository variables. The token can act across the whole organization, so it stays in CI and never
   reaches an artifact.
2. In the tag build, build with hidden source maps, inject debug ids, upload with `sentry-cli`, then
   delete the maps before `dist` packages anything.
3. Do the same for the renderer's Vite build.
4. Add a check that fails the build if a `.map` file is inside a bundle.

## Acceptance

- An error thrown in a tag build shows original file names and line numbers in Sentry.
- The packaged app contains no `.map` files.
