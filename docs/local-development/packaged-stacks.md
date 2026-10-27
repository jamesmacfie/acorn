# Reading a packaged stack

This page explains how to find the source line behind a stack from a packaged Acorn build. Read it
when a crash report or a Sentry event points into a minified file. It's part of
[local development](../local-development.md).

## Find the source line

The Node service and the loaded plugin packages ship minified, with function and class names kept. A
packaged stack names the function, such as `at openDataRoot (…/helper/chunks/inputGrants-B09qKGjl.js:1:3409)`,
but its line and column point into a minified file. To find the source line:

1. Check out the commit the stack came from. A release's version and checkout are in its size report.
2. Run `pnpm --filter @acorn/node build`. The build writes hidden source maps beside each file in
   `apps/node/dist`. Output is byte-for-byte reproducible from the same commit, and chunk names carry
   a content hash.
3. Paste the stack into `pnpm --filter @acorn/node locate-stack < stack.txt`. Each frame gains its
   source file, line, and column in brackets.

A frame whose file isn't in the build prints `[no map in this build]`. That means the stack came from
different code, usually another commit. For a loaded plugin package, build it with maps into a scratch
folder, then point the lookup at it:

```sh
pnpm --filter @acorn/node build:plugin rollbar -- --package-root /tmp/maps --sourcemap
pnpm --filter @acorn/node locate-stack -- --dist /tmp/maps/rollbar/dist < stack.txt
```

Source maps never ship in the installer or the standalone tarball. A tag build uploads the desktop
app's maps to the acorn team's Sentry project, so a stack there already shows source lines. For more
information, see [Readable stacks](../integrations/sentry/the-acorn-teams-dsn.md#readable-stacks).

The packaged Node sends the same numbers, and what it measures on disk, as byte gauges
([shipped bytes](../telemetry/runtimes.md#shipped-bytes)).
