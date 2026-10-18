# Phase 4: trim the Node's boot on a long-used data root

Date: October 19, 2026. Status: proposed. Needs phase 1's `node.boot` spans from the owner's data
root.

On a scratch data root, the Node listens about 300 ms after its boot timer starts. On the owner's
root it took 1,159 ms on October 18, 2026, and the split of that time isn't recorded. This phase
finds where the extra 850 ms goes and removes what it can, then takes the worktree check out of the
cleanup's critical path. Read [the programme](./README.md) first.

## Starting point

- Three boots of the staged Node on a scratch root that had booted once, October 19, 2026:
  `bundled-packages` 38 to 51 ms, `migrate` 6 to 9 ms, `graph` 136 to 142 ms, plugin setup about
  100 ms, and listening at +293 to +313 ms. Before the timer started, spawning and evaluating the
  bundle took another 216 to 252 ms.
- The owner's root differs in ways that could each cost time. `core.sqlite` is 11 MB with a 3 MB
  write-ahead log. Twelve plugin databases sit beside it, and `agents.sqlite` alone is 3.4 GB. The
  plugins folder holds four loaded packages the scratch root lacks: `agent-attachment-image`, linked
  for development, plus `kawaii`, `machine-stats`, and `runn`. It also holds two that
  `disabled-plugins.json` turns off, `findings` and `worktree-manager`.
- `loadExternalPlugins` in `packages/node-core/src/server/plugins/loader.ts` starts every loaded
  package's worker at once. So `graph` is the slowest worker's start, not the sum.
- Each plugin with tables opens and migrates its own database in `init`. The per-plugin boot lines
  are wall-clock slices, so a plugin's line says when it finished, not what it cost
  ([profiling](../../local-development/profiling.md#the-nodes-marks)).
- The supervised Node already keeps compiled code between launches through `NODE_COMPILE_CACHE`
  (`packages/custody/src/supervision/compileCache.ts`).
- `reconcileWorktrees` in `packages/node-core/src/server/worktrees/taskWorktree.ts` sweeps set-aside
  folders, then calls `computeTaskStatuses` for every active task. That runs `git status` per
  worktree, only to warn about worktrees missing on disk, which `isDir` already answers. It took
  470 ms on the owner's root. It runs before the agents cleanup, so it delays that too. In a packaged
  build it also waits for the login shell, which phase 2 removes.
- `worktreeStatus` in `packages/node-core/src/server/worktrees/worktreeStatus.ts` shares a `git status`
  that's still running between callers, and caches a success briefly. The window asks for the same
  statuses through `/v1/core/task-statuses` right after the Node listens.

## Changes

### Find the expensive boot step

1. From phase 1, rank the owner's `node.boot.mark` steps before `listener-up` by their median over
   the baseline day. Compare each with the scratch figures above.
2. Profile the step with the largest gap. Run the dev app's Node with `--cpu-prof`. Check how
   `ServiceHost` builds the child's arguments and environment in
   `packages/custody/src/supervision/serviceHost.ts` to find where the flag can go. Don't commit the
   flag.
3. Fix what the profile shows, within the rule from [the programme](./README.md#what-holds-across-every-phase):
   work moved after the listener binds must make early requests wait, never answer wrongly.

What to look for, by step:

- **`graph`.** Does a disabled package still start a worker? It shouldn't, and stopping it is a pure
  saving. Does one package's worker take far longer than the rest? Then look at what its Node half
  does at import, because that's the plugin author's cost and it may belong in their `ready`.
- **`migrate`.** On a current journal the migration itself is one `SELECT`. A slow step here is
  `makeRuntime` opening the database, replaying the write-ahead log, or building a binding.
- **Plugin setup.** Read the profile, not the lines. Several plugins open their databases at once, so
  the slow one may finish early and push its cost onto the next line.
- **`process`.** If the time before the timer grew, check that the release build's compile cache
  folder fills and gets reused between launches.

### Take the worktree check out of the way

Replace the `computeTaskStatuses` call in `reconcileWorktrees` with a check of each active task's
worktree folder with `isDir`, and keep the same warning. The window's first status read starts the
`git status` runs itself, and in-flight sharing means nothing gets lost. The agents cleanup then
starts about 470 ms sooner on the owner's root.

Keep `sweepAsideWorktrees` where it is. It decides whether a set-aside folder goes back or gets
deleted, and that has to happen before anything reads worktrees.

## Tests

- A `reconcileWorktrees` test in `packages/node-core/src/server/worktrees/taskWorktree.test.ts`: a
  missing worktree still produces the warning, a present one doesn't, and no `git` process starts.
- A test for each boot change, in the package that owns the step.
- `pnpm --filter @acorn/node build` keeps the service budget green.

## Acceptance

Against phase 1's baseline:

- On the owner's root, the Node listens within 800 ms of the helper's ready line at the median, or
  the evidence page explains which remaining step stops it and why it stays.
- `reconcile.worktrees` takes under 50 ms on the owner's root.
- `/v1/core/task-statuses` answers the same statuses as before on the first read after launch.
