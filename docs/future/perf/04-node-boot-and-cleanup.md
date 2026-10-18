# Phase 4: trim the Node's boot on a long-used data root

## Completion note

The worktree change landed on October 19, 2026. The boot-step search found nothing to fix on a
scratch root, so no boot code changed. Phase 1's baseline from the owner's data root doesn't exist
yet, so the owner-root ranking waits for it. All three [acceptance](#acceptance) items stay open,
because each needs launches on the owner's data root.

What changed:

- `reconcileWorktrees` reads the active tasks that have a worktree path, skips any being archived,
  and checks each folder with `isDir`. The warning text is the same. It no longer calls
  `computeTaskStatuses`, so boot starts no `git` process after the set-aside sweep.
- Test: a `reconcileWorktrees` case in `taskWorktree.test.ts` with one present and one missing
  folder. It expects one warning that names only the missing folder, and no call to
  `child_process.spawn`, spied through a pass-through mock so the file's other cases still run real
  Git. It fails on the old code, which spawned `git`.
- Docs: [worktrees](../../workspaces-and-tasks/worktrees.md) says boot doesn't run the sweep.
- The service graph grew by 91 B, from 1,888,511 B to 1,888,602 B. Both are over the 1,884,400 B
  ceiling, which the base already failed.

Decisions and deviations:

- The status sweep also seeded the `head:changed` observer at boot. The client's first status read
  seeds it instead. A commit made between boot and that first read raises no `head:changed`, which
  matters only on a Node with no client attached for a while. The comment on the observer and the
  worktrees doc say so. Firing the sweep in the background would have kept the seed, but it would
  run `git` during the agents cleanup, which is what this phase moves out of the way.
- The old `try` around the status call went away. A failed read of the tasks table now throws to
  `reconcileNode`, which already logs `worktree reconcile failed` and carries on.

Finding the expensive step, on scratch roots only:

- Both roots used the staged `apps/desktop/dist/helper/standalone.js` under the bundled Node 24.21.0,
  with `NODE_ENV=production` and a compile cache beside the root. One root held only the bundled
  packages. The other added copies of the owner's `kawaii`, `machine-stats`, `runn`,
  `agent-attachment-image`, `findings`, and `worktree-manager`, plus the owner's
  `disabled-plugins.json`. Neither held the owner's databases.
- Over 10 alternating boots, `graph` took 143 ms at the median on the bundled-only root and 155 ms
  with the owner's packages. The Node listened at +290 ms and +329 ms. `bundled-packages` took 40 ms
  and `migrate` 6 ms on both. The owner's package set explains about 40 ms of the 850 ms gap.
- Disabled packages don't start workers on the owner's root. `findings` and `worktree-manager` both
  declare plugin API 2, and `scanInstalled` refuses them before `loadEntry`, at the cost of a
  manifest read. The loader would still start a worker for a disabled package that speaks API 5,
  because `assembleNodeGraph` runs before `bootNode` reads the disabled list. Fixing that saves the
  owner nothing measurable, so it isn't done here.
- A `--cpu-prof` boot of the owner-shaped root spent 774 ms of 1,203 ms of main-thread time idle,
  waiting on the plugin workers. No function took more than 32 ms of its own time.
- So the gap comes from what the scratch roots lack: the owner's 10 MB `core.sqlite` and its
  write-ahead log, the 3.4 GB `agents.sqlite`, the other plugin databases, or the machine's state at
  launch. Rank the `node.boot.mark` steps from the baseline before profiling again. The `process`
  step's compile-cache check needs a release build, which this phase didn't run.

What later work needs to know:

- `reconcile.worktrees` on the owner's root should now cost one query plus one `stat` per active
  task. Confirm it's under 50 ms from the baseline launches.
- The first `/v1/core/task-statuses` read after launch runs every `git status` itself, with nothing
  from boot to share. It answers the same statuses, but it may take longer than before on a large
  roster.

Date: October 19, 2026. Status: worktree change landed. The boot ranking waits for phase 1's
`node.boot` spans from the owner's data root.

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
