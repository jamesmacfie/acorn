# Phase 2: stop launch-time spawns waiting for the login shell

Date: October 19, 2026. Status: proposed.

A packaged macOS build holds every process the Node starts until the owner's login shell has reported
its `PATH`. On the owner's machine that takes more than two seconds, and every Git status, provider
check, and worktree check at launch waits for it. This phase reuses the last launch's answer so
nothing waits. Read [the programme](./README.md) first.

## Starting point

- `beginLoginShellPath` in `packages/node-core/src/server/core/loginShellPath.ts` runs only on a
  packaged macOS build. It runs `$SHELL -lic 'printf %s "$PATH"'` with a five-second limit, sets
  `process.env.PATH` from the answer, and holds spawns until it settles.
- Four call sites await `spawnsReady()` before they start a process: `runProcess` in
  `packages/node-core/src/server/core/proc.ts`, `runHeadless` in
  `packages/node-core/src/server/headless.ts`, and two in
  `packages/node-core/src/server/modelProviders/harnessRuntime.ts`. That covers Git, the worktree
  cleanup, and the harness checks behind the model pickers. Phase 1's spans show which other launch
  reads wait.
- The owner's login shell is `/bin/bash`. Three runs of the probe took 2,557 ms, 2,134 ms, and
  2,200 ms on October 19, 2026, with test suites loading the machine. [Boot order](../../node-distribution.md#boot-order)
  quotes 520 ms on another machine and up to two seconds with a version manager.
- The development app skips the probe, because its `PATH` is the terminal's. That's why no Sentry
  data shows this cost, and why phase 1's release baseline is the before number.
- Terminal sessions run `$SHELL -lc` and read the profile themselves. The managed-agent drivers call
  `spawn` directly and skip the gate. Neither changes here.

## Changes

1. Keep the last good answer in the data root, in a file beside `node.json`, holding the shell path,
   the `PATH` value, and when it was read. Write it with `writePrivateAtomic` from
   `packages/node-core/src/server/storage/dataRoot.ts`, so it's mode `0600` and never half-written.
2. Pass the data root to `beginLoginShellPath`. `bootNode` in `apps/node/src/composition/boot.ts`
   has it at the first step.
3. At boot, read the file. If it exists and names the same `$SHELL`, set `process.env.PATH` from it
   and don't hold spawns. Then run the probe in the background.
4. When the background probe answers, set `process.env.PATH` to the new value and rewrite the file.
   A spawn after that point gets the fresh `PATH`. When it fails, warn as today and keep the cached
   value.
5. With no file, or a different shell, hold spawns exactly as today. That's the first launch of an
   installation, and the first launch after the owner changes shell.
6. Ignore a file that doesn't parse, or whose `PATH` is empty, and treat it as missing.

Don't make the probe cheaper instead. Dropping `-i` misses `PATH` entries that a profile adds in its
interactive file, which is where version managers usually put them, and a shorter timeout trades a
slow launch for a wrong `PATH`.

## What changes for the owner

A `PATH` edit reaches processes the Node starts about two seconds into the launch after the edit,
when the background probe answers. Before that, they use the last launch's `PATH`. A tool installed
into a new folder can show as missing in that window. Check whether a provider answer cached in
that window stays cached, and if it does, refresh it when the background probe answers.

Say this in [boot order](../../node-distribution.md#boot-order) when the change ships.

## Tests

Extend the probe tests in `packages/node-core/src/server/core/proc.test.ts`, which drive
`holdSpawnsUntil`:

- With a cached file for the same shell, a spawn starts before a slow probe settles, and uses the
  cached `PATH`.
- After the probe settles, the next spawn uses the probe's `PATH`, and the file holds it.
- With no file, a spawn waits for the probe, as today.
- With a file for another shell, a spawn waits.
- A failed probe leaves the cached `PATH` in place and the file unchanged.
- An unreadable or empty file counts as missing.

## Acceptance

- In the release build, `login-shell.settled` from phase 1 still lands about two seconds in, and
  the first `proc.spawn` at launch no longer waits for it. Check with the `[perf:request]` timings and
  the Git pane's `ui.feature.open` on a cold launch.
- Git and Agents `ui.feature.open` with `first:true` on a release cold launch drop by roughly the
  probe's time against phase 1's baseline. Record both numbers.
- The first launch of a fresh installation behaves as before.

## Risks

- The file holds the owner's `PATH`, which can name private folders. It stays in the data root, mode
  `0600`, beside files that hold keys, and never leaves the machine.
- A cached `PATH` from an older profile can point at a removed folder for the first two seconds. A
  spawn then fails as a missing binary, the same as a `PATH` without that tool.
