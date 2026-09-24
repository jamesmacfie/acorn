# Measurement and guardrails

Date: 2026-09-24. Status: proposal. [Back to the plan](./README.md).

The September programme left two build checks and a set of boot marks. One of the checks stopped
measuring anything on 2026-09-24, the node has no check at all, and nobody has timed a task switch in
the real window. Fix these first, because every other file here needs a number to argue from.

## M1: Make the renderer startup check see the real graph

**What was found.** `apps/desktop/scripts/check-renderer-budget.mjs` sums the scripts and
`modulepreload` links in the built `index.html`. Commit `d5ba5393` (2026-09-24) made
`apps/desktop/src/client/bootstrap.ts` the entry, and that file loads the app with
`import('./index.tsx')`. The built HTML now names one 9.6 KB script and no preloads, so the check
reports this:

```
[renderer-budget] startup scripts=9654B styles=0B assets=1 depth=1
[renderer-budget] one interaction away: 194 more chunks, 969982B (not counted)
```

The window still loads all of it before it draws. Reading the entry chunk's `__vite__mapDeps` list
gives the real startup set: 191 scripts totalling 869,628 B plus three stylesheets totalling
100,354 B. The byte ceiling and the chunk-name denylist both pass on 9.6 KB, so a 300 KB regression
would pass too.

**Change.** Make the check follow the entry chunk's own dynamic import. The entry is a startup
guard, and the chunk list Vite writes into its `__vite__mapDeps` call is what the window fetches
next. Count that list as startup. The simpler fix, removing the extra hop in
[R1](./03-renderer-startup.md#r1-remove-the-serial-hop-in-front-of-the-app), also restores the old
shape, but the check should not depend on how the entry is written.

Add a floor as well. A startup set under 100 KB means the check is reading the wrong thing, so fail
the build rather than pass it.

**Done when.** The check reports within 5% of the real set, fails on a denylisted name reached through
the entry's dynamic import, and fails when the counted set drops below the floor. A test in
`apps/desktop` holds both failures.

## M2: Lower the renderer ceiling to the number you have

The script ceiling is 1,250,000 B. It was set on 2026-08-31, when startup was 1.3 MB. On 2026-09-03
startup was 631,512 B, and at `8bf4a71b` without the bootstrap it is 857,918 B. The ceiling has 390 KB
of slack, so it catches nothing short of a disaster, and the 226 KB of drift since September passed
without a word.

After [R1](./03-renderer-startup.md#r1-remove-the-serial-hop-in-front-of-the-app) and
[R2](./03-renderer-startup.md#r2-take-plugin-code-off-the-startup-graph) land, set the ceiling to the
measured figure plus about 5%. Raise it in the same commit as any change that needs more, with the
reason in the commit message. That is the rule [frontend.md](../../../frontend.md) § Startup budget
already states for the terminal client.

## M3: Give the node service bundle a size check

**What was found.** The node's one service chunk was 1,110,974 B on 2026-09-03. At `8bf4a71b` it is
`apps/desktop/dist/helper/chunks/crash-BxUhyi6G.js`, 1,910,384 B, which is 72% larger. No check
noticed, because the node build has none. Evaluating it costs 345 to 380 ms
([02](./02-node-boot.md)), which is on the path to the first frame.

Its name is also misleading. Rolldown names a chunk after one module in it, and this one happens to
carry `crash.ts`. That is harmless, but anyone reading `[service:boot]` output should know the service
chunk is whichever `chunks/*.js` file `service.js` imports.

**Change.** Add a script to `apps/node` that runs after `vite build`. It reads `dist/service.js`,
follows its static imports, sums the bytes, and fails over a ceiling set at the measured figure plus
about 5%. List the bare imports it leaves external, so a new heavy dependency shows up in build
output. After [N1](./02-node-boot.md#n1-inline-pure-javascript-dependencies-into-the-service-bundle)
the byte count grows, because dependencies move inside the bundle. Reset the ceiling in that commit
and track evaluation time instead, below.

**Also add an evaluation-time test.** `apps/desktop/test/boot.test.ts` already spawns the real helper
with `ACORN_PERF=1`. Assert that `service.start` minus `ready line` stays under a generous bound, such
as 1,500 ms. A timing assertion in CI is noisy, so make the bound wide. It exists to catch a
dependency that adds half a second, not to hold a number.

## M4: Time a task switch in the real window

**What was found.** Every task-switch number in the September record came from jsdom, counting calls
at a seam (see [phase 8](../../../performance/2026-09-03--phase-8.md)). Nobody has timed a real task
switch with a real agent session, terminal, and changes pane open. The telemetry exists:
`nav.change` in `packages/client-core/src/features/tasks/pageChange.ts` ends on the second animation
frame after the switch, and `pane.region` spans each region from request to mount
([telemetry.md](../../../telemetry.md) § Renderer seams).

**Change.** Write down a repeatable recipe and take a baseline before anything in
[05](./05-task-switching.md) ships:

1. Start an isolated session with `pnpm dev:agent -- --session perf`.
2. Create or pick two tasks. Give task A a long agent session, the changes pane, and an open terminal
   drawer with two tabs. Give task B the editor with a file open.
3. Turn telemetry on in **Settings**, then alternate A, B, A, B by clicking the two rail rows through
   `pnpm dev:agent:ui -- --session perf`, 20 switches. Take a `snapshot` after each switch, because
   the driver's element references change with the UI.
4. Read the `nav.change` and `pane.region` durations from the telemetry page, and the request count
   per switch from `[perf:request]` lines with `ACORN_PERF=1`.

Record the median and the worst of the 20, per direction. The first switch into a task and a switch
back to a task you just left are different cases, and the plan treats them differently, so report
them separately.

This is a development build, so the absolute numbers run high. Use them for before-and-after on the
same machine, not as the shipped figure. The dev driver cannot see native child webviews, so leave
the preview pane closed.

**Done when.** The recipe is in [local-development.md](../../../local-development.md) and the baseline
table is at the top of [05](./05-task-switching.md).

## M5: Take the packaged numbers the September programme could not

Three measurements have been owed since 2026-09-03 because they need a packaged build and a person at
the machine. Take them once, after [02](./02-node-boot.md) and [03](./03-renderer-startup.md) land:

- `first paint` and `tree built` from a `pnpm dist` build launched from Finder with the window
  frontmost, with `localStorage.setItem('acorn.perf', '1')` set.
- A second launch of the same build, to see whether the `immutable` cache header on `/assets/*` does
  anything. Custom-scheme responses in WKWebView might bypass the HTTP cache entirely. If they do,
  say so in [shell.md](../../../shell.md) § Renderer origin and protocol handler and stop counting on
  the header.
- The window-to-node gap, reading the Rust, helper, node, and renderer marks side by side.

## Verify before building

- Confirm the entry chunk still carries a `__vite__mapDeps` list. If the bundler changes how it
  preloads dynamic imports, M1's reader needs a different source, such as the build manifest.
- Confirm `apps/desktop/test/boot.test.ts` still prints `service.start` and `ready line` marks.
- Confirm `nav.change` still ends on the second animation frame, and that macOS does not pause those
  frames in a background window during the dev-agent run. If it does, keep the window frontmost.
