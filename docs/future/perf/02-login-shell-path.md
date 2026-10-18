# Phase 2: stop launch-time spawns waiting for the login shell

## Completion note

The code landed on October 19, 2026. The release measurements under [acceptance](#acceptance) aren't
taken, because they need phase 1's release baseline, which the owner records. All three acceptance
items stay open.

What changed:

- `beginLoginShellPath(isPackaged, dataDir)` takes the data root. `bootNode` passes `root.dir`.
- `startLoginShellPath(dataDir, shell, probe)` holds the cache and the gate. It reads
  `login-shell-path.json` beside `node.json`, holding `shell`, `path`, and `readAt`. When the file
  names the same shell and a non-empty `PATH`, it sets `process.env.PATH` from it and holds nothing.
  Otherwise it holds spawns on the probe as before. When the probe answers, it sets `PATH` and
  rewrites the file with `writePrivateAtomic`. A failed probe warns and keeps the cached `PATH`, and
  the file stays as it was.
- The file is listed in [the data root](../../data-layer/data-root.md#where-it-lives), in the reset
  inventory in `scripts/reset/inventory.mjs`, and on the public site's "Where your data lives" page.
- [Boot order](../../node-distribution.md#boot-order) says what the owner sees after a `PATH` edit.
- Tests: six new cases in `packages/node-core/src/server/core/proc.test.ts`, one for each item under
  [tests](#tests). They drive `startLoginShellPath` with a probe the test controls.

Decisions and deviations:

- The tests call `startLoginShellPath` rather than `holdSpawnsUntil`, because the cache sits above
  the gate. `beginLoginShellPath` keeps the platform check and the real shell, and nothing else.
- A failed write of the cache file warns and leaves the fresh `PATH` in place. The probe's promise
  still never rejects, so `login-shell.settled` and the boot spans are unchanged.
- No provider answer from the stale-`PATH` window outlives its normal refresh, so nothing refreshes
  on the probe's answer. The Node holds no answer about a missing CLI. `harnessBackends` and
  `listProfiles` run `which` on every read, and the Codex model catalog caches only a success. The
  clients hold `/v1/core/models/backends` for 30 seconds and the terminal profile list for five
  minutes, and the agents usage service holds a reading for five minutes. The terminal list and the
  usage reads never waited for the probe, so in that window they used launchd's bare `PATH` before
  this change. They see the cached `PATH` now, which is closer to right.
- `docs/node-distribution.md` was at its 200-line limit, so the boot-order text was rewritten to fit
  rather than grown. It dropped the 520 ms figure and the five-second ceiling, which the code keeps.
- The site pages that cite `docs/node-distribution.md` don't describe the probe, so only "Where your
  data lives" changed and was marked.
- `pnpm --filter @acorn/node build` fails its service budget, as it did on the base commit. This
  change adds 952 B, from 1,887,041 B to 1,887,993 B against a 1,884,400 B ceiling. The ceiling
  wasn't raised.

For later phases:

- On a release cold launch with a cached file, `login-shell.settled` still lands about two seconds
  in, but the first `proc.spawn` shouldn't wait for it. On the first launch of an installation, it
  still does.
- The managed-agent drivers and the terminal profile list still skip `spawnsReady()`. With a cached
  file that matters only on a first launch.

Date: October 19, 2026. Status: code landed, release measurements not taken.

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
