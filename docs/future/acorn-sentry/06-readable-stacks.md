# Phase 6: readable stacks

Date: October 26, 2026, from the October 17, 2026 plan. Status: not started. Depends on
[phase 4](./04-ship-the-dsn-in-release-builds.md).

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
