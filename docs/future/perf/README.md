# Make a cold launch usable sooner

Date: October 19, 2026. Status: proposed. Implementation not started.

This programme shortens the time from opening the desktop app to a window you can work in. It
targets a cold launch, where the shell, the helper, and the Node all start from nothing, on a data
root that has seen weeks of use. Read this page before you pick up a phase.

[Startup budget](../../frontend/startup-budget.md) owns the byte checks on what each runtime loads.
[Profiling](../../local-development/profiling.md) owns how to time a launch. This programme changes
neither rule, and it doesn't try to load fewer bytes.

## What the programme delivers

At the end, these hold on the owner's own data root, in a release build, with the window visible:

- Every launch reports where its time went, including the Node's steps before telemetry turns on,
  and Sentry can tell a release launch from a development one and a cold launch from a reload.
- No process the Node starts at launch waits for the login shell's `PATH`, except on the first launch
  of a new installation.
- The agents plugin's post-start cleanup no longer holds up the window's first requests, and the
  Agents pane opens from cached data on a cold launch.
- The Node listens sooner on a long-used data root, by an amount phase 1 decides.
- A dated evidence page in `docs/testing/` compares the release build before and after.

These targets are proposed. The owner confirms or changes them once phase 1 has a release baseline:

- `renderer.startup.usable` on a cold launch: under 2 s at the median and under 4 s at the 95th
  percentile, over one working week.
- No `ui.feature.open` timeout in the first minute after a cold launch, over the same week.
- The Node listening within 800 ms of the helper's ready line on the owner's data root.

## Starting point

Two sources, both read on October 19, 2026 at `177a7c6df`.

**Sentry, the last 14 days.** Org `acorn-u3`, project `acorn-development`. Every launch in it came
from the owner's `pnpm dev:no-watch` app: a debug Rust shell and a Vite-served renderer, but the
same staged helper and Node files a release ships. So the helper and Node numbers apply to a release.
The renderer's script loading doesn't.

- Over 49 launches, the helper waited for the Node to listen for 1,127 ms at the median, 1,516 ms at
  the 75th percentile, and 3,068 ms at the 95th (`helper.boot.mark` with `mark:service.start`). The
  helper's own steps added about 86 ms.
- The wait grew. The whole helper account had a median of about 1.1 s from October 4 to 11, and
  about 1.6 s from October 12 to 18.
- In visible windows, `renderer.startup.usable` was 1,193 ms at the median and 9,279 ms at the 95th
  percentile, over 94 launches. Most of those were reloads, with the Node already up.
- Ten launches matched a helper boot, so they were cold. Two ran in a visible window: one was usable
  at 2,331 ms, and the other hit the 30-second timeout. The hidden ones ranged from 2.6 s to 20
  minutes. A hidden window runs at background priority, so those numbers aren't comparable.
- The Agents pane was the slowest feature on a first opening: 1,193 ms at the median and 11,231 ms
  at the 95th percentile, over 34 openings. It caused four of the six `ui.feature.open` timeouts.
- On the October 18 cold launch, the Node listened at +1,159 ms on its own clock. Then
  `reconcile.worktrees` took 470 ms and `reconcile.agents` took 1,451 ms.

**Local runs on an Apple silicon Mac.** The staged `apps/desktop/dist/helper/standalone.js` ran under
the bundled Node 24.21.0 against a scratch data root, while other test suites loaded the machine:

- On a scratch root that had already booted once, the Node listened 516 to 565 ms after spawn. About
  230 ms of that came before its clock started, `graph` took 136 to 142 ms, and plugin setup took
  about 100 ms. `reconcile.agents` took 9 to 12 ms, and `reconcile.worktrees` took 1 ms.
- The owner's login shell is `/bin/bash`. `bash -lic 'printf %s "$PATH"'` took 2,134 to 2,557 ms
  over three runs. A release build waits for that before every process it starts.
- The owner's `plugins/agents.sqlite` is 3.4 GB: 833,024 events in 1,216 sessions. `agent_events`
  holds 1,997 MB, and the full-text index keeps another 1,019 MB.
- The renderer build of October 17 fetches 951,018 B of scripts and 125,792 B of styles at startup,
  in 151 files and one round of fetches.

Earlier evidence says bytes aren't the lever here. On October 9, 2026, halving the Node's graph and
minifying it made no measurable change in time to listen
([production minification](../../testing/production-minification-2026-10-09.md)).

## The phases

| Phase | What changes |
| --- | --- |
| [1](./01-measure-cold-launch.md) | The Node's boot becomes spans, launches say whether they waited for the Node, and a release-build baseline is recorded. |
| [2](./02-login-shell-path.md) | The Node reuses the last launch's login-shell `PATH`, so spawns at launch don't wait for the probe. |
| [3](./03-agents-at-launch.md) | The agents cleanup stops blocking the Node's first answers, and the Agents pane opens from cache. |
| [4](./04-node-boot-and-cleanup.md) | The Node's steps before it listens, and the worktree cleanup, lose what phase 1 shows they waste. |
| [5](./05-release-only-costs.md) | The keychain read, the first-launch Gatekeeper scan, and the renderer's file count, fixed only if phase 1 shows a cost. |
| [6](./06-acceptance.md) | The release baseline runs again, and the evidence and owning docs are updated. |

## Order and dependencies

Phase 1 comes first. Every later phase compares against its numbers, and phases 4 and 5 choose
their changes from them.

Phase 2 needs nothing from phase 1 to build, and it's the largest release-only cost found so far.
Ship it straight after phase 1's baseline, so the before number exists.

Phase 3 needs phase 1's per-step timing inside the agents cleanup. Phase 4 needs the Node boot spans
on the owner's data root. Phases 3 and 4 can run side by side.

Phase 5 needs phase 1's release baseline, and may end with no code change. Phase 6 comes last.

## What holds across every phase

- Measure before and after, on the same machine, with the same method, and record both. A change
  with no measured gain gets reverted, however reasonable it looked.
- Compare a visible window with a visible window. A `pnpm dev:agent` window is always hidden, so use
  it for counts and correctness, not for launch times.
- Work moved after the Node starts listening must not change answers. A request that arrives before
  the work finishes waits for it or gets the same answer it would have had. It never gets a 404 or an
  empty list that later fills in as though it were real.
- Persisted data keeps its shape, or gets a migration in the same change.
- New spans and attributes follow [the admission rule](../../telemetry/model.md#the-admission-rule-for-a-span),
  and each one updates its seams table in the same change.
- The startup budgets stay green. A phase that has to raise one says why in its commit message.
- When a phase ships behavior, document it in the owning page and trim the phase here. The owners
  are [profiling](../../local-development/profiling.md), [boot order](../../node-distribution.md#boot-order),
  [Node seams](../../telemetry/runtimes.md#node-seams), and
  [startup milestones](../../telemetry/renderer.md#startup-milestones).

## Out of scope

- Loading fewer renderer or Node bytes. The budgets own that, and the October 9 evidence shows bytes
  didn't move time to listen.
- Shrinking `agents.sqlite`. The full-text index stores its own copy of event text, about 775 MB on
  the owner's root, and an external-content index would save most of it. That's a storage change
  with its own migration. Take it up separately if phase 3 shows that disk reads at launch matter.
- Slow requests after launch, such as `/v1/p/agents/usage` at a 3.8 s median. The
  [performance spans plan](../performance-spans.md) covers those.
- Signing and notarization. [The bundle plan](../bundle.md#sign-macos-artifacts) owns them.

## Why

The window already opens before the Node is up and draws its saved cache, so the first frame is
fast. What a person waits for is the first answer from the Node, and on a long-used data root that
answer sits behind three things: the Node's own boot, its cleanup after it listens, and, in a
release build only, a login-shell probe that holds every process it starts. The development app
skips the probe, which is why nobody using it has felt that cost. Each phase removes one of those
waits, and phase 1 makes sure each removal can be measured.
