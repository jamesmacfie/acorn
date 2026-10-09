# Performance baseline, October 9, 2026

This page records the startup and size baseline taken before the October 2026 startup and size
work. Later evidence pages compare against it. The figures are dated evidence. Don't edit them.
Phase numbers below refer to the October 2026 performance programme. Its plans were deleted on
October 9, 2026, and remain in git history.

## Setup

- Checkout: `d44d16077` with phase 01's instrumentation applied and uncommitted. The instrumentation
  adds a few kilobytes to each startup graph. The terminal client's graph was 729,437 bytes without
  it and 729,918 bytes with it.
- Platform: macOS 27.0 on Apple silicon (`darwin-arm64`). Bundled Node runtime 24.21.0. The build
  toolchain ran Node 24.11.0.
- Builds: production renderer, terminal client, and Node service builds, unminified. The Rust shell
  was a debug build with the `agent-automation` feature, from `pnpm dev:agent`.
- Every launch ran in a `pnpm dev:agent` session. Its window reports `visibilityState: hidden`, so
  every timing below is a background-priority launch. Compare them with each other, not with a launch
  someone watched.
- Telemetry was off. Timings come from the renderer's `performance` marks, read through the session's
  WebDriver client, and the Node's `[service:boot]` lines.
- `pnpm dev:agent` stages the Node service, and staging fails the service graph's 3,181,000-byte
  ceiling at this checkout. The ceiling was raised locally for these runs only and put back.

## Startup timings

Milliseconds from the renderer document's navigation. `restored` and `usable` came from a landing on
the project's Home source, which closes on mount, so `usable` there is a proxy.

| Launch | First frame | `nodeReady` | Restored | Usable | Node `listener-up` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fresh data root, run 1 | 149 | 413 | 488 | 527 | 416 |
| Fresh data root, run 2 | 153 | 613 | 705 | 722 | 499 |
| Fresh data root, run 3 | 141 | 529 | 599 | 619 | 418 |
| Established data root, run 1 | 180 | 595 | Not reached | Not reached | 377 |
| Established data root, run 2 | 168 | 312 | Not reached | Not reached | 349 |
| Reload in the same window, run 1 | 954 | 83 | 345 | 361 | n/a |
| Reload in the same window, run 2 | 880 | 54 | 307 | 315 | n/a |
| Reload in the same window, run 3 | 857 | 53 | 307 | 315 | n/a |
| Reload after an established relaunch | 62 | 80 | 337 | 357 | n/a |

The Node's `listener-up` is from its own process start, not from navigation. Its `graph` step took
102 to 143 ms on every launch.

Three findings came out of these runs:

- On an established data root, a cold relaunch never ran the startup restore. The window stayed on
  **Select a project** for 90 seconds, and a reload then restored normally. The same happened with
  phase 01's client changes reversed, so the cause predates this phase.
- In a hidden window, a reload's `first-contentful-paint` lands 500 ms or more after `usable`. A
  cold launch's paint lands first.
- The first fresh launches of the session never recorded `restored`, because the shell mounted once
  under the placeholder cache and once for a remembered Node before the real one. Phase 01's account
  rule was changed to belong to the first Node that restores. The three fresh runs above are after
  that change.

## Startup graphs

From `apps/desktop/scripts/size-report.mjs` and the build checks, in bytes:

| Graph | Bytes | Ceiling | Result |
| --- | ---: | ---: | --- |
| Renderer startup scripts | 802,554 | 775,000 | Over |
| Renderer startup styles | 121,989 | 200,000 | Under |
| Renderer registration after the first frame | 242,200 | None | Reported |
| Renderer, one interaction away | 1,780,974 | None | Reported |
| Node service static graph | 3,193,213 | 3,181,000 | Over |
| Terminal client startup closure | 729,918 | 723,000 | Over |

All three ceilings were already exceeded before phase 01's changes.

## Installed bytes

Staged resources, before packaging, in bytes:

| Component | Bytes | Files | JavaScript bytes |
| --- | ---: | ---: | ---: |
| Renderer | 13,479,536 | 536 | 13,117,748 |
| Frame bridge | 271,533 | 2 | 94,633 |
| Node service | 6,056,340 | 269 | 5,021,306 |
| Runtime dependencies | 297,035,258 | 5,161 | 24,591,408 |
| Command-line client | 652,639 | 3 | 652,621 |
| Bundled plugins | 4,237,635 | 32 | 4,171,766 |
| Bundled Node executable | 122,129,232 | 1 | 0 |
| Total | 443,862,173 | | |

The report excluded 1,241 files, mostly source maps under the runtime dependencies. It listed two
missing components: the Rust shell binary, which a debug session doesn't build at the release path,
and the compressed release artifacts, which only packaging produces.

## Not measured

- A visible launch. Every run above was hidden.
- Installer and update archive sizes. CI's packaging run writes them.
- Live Sentry delivery. Phase 07 owns it. Envelope and exporter tests cover the conversion.
