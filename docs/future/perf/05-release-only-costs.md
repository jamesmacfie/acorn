# Phase 5: check the costs only a release build pays

## Completion note

The timing lines landed on October 19, 2026. Nothing under
[fix what crosses its threshold](#fix-what-crosses-its-threshold) was done. Each fix needs five
release launches from Finder, which only the owner can run, and the keychain option is the owner's
call. Both [acceptance](#acceptance) items stay open.

What changed:

- `apps/desktop/src-tauri/src/boot_marks.rs` prints `[shell:boot] <label> +<ms>ms (<ms>ms)` to
  stderr when `ACORN_PERF=1`, the shape of the helper's lines. `run` starts the clock first thing.
  With the switch off, a mark only checks an empty lock.
- The marks, in order: `setup` when Tauri hands over, `roots` once both roots and the bundle check
  are done, `keychain` after the data-key read, `helper spawned` right after the spawn,
  `helper ready` when the ready line arrives, and `window built` after `open_window`. A launch in
  tray mode stops at `helper ready`.
- `boot` reads the data key before it builds the handshake, so `keychain`'s own time is the keychain
  read and the file fallback, nothing else.
- Test: one unit test for the line format. The marks themselves print and do nothing else.
- Docs: a Shell row in [the other processes](../../local-development/profiling.md#the-other-processes).

Decisions and deviations:

- `setup` and `roots` aren't in the plan. Without a mark right before the read, the `keychain` step
  would include Tauri's start, the data roots, and the crash hook, and the 50 ms threshold couldn't
  be read off it.
- The clock is one process-wide value behind a lock, like the helper's module-level clock. Passing a
  timer through `boot` into `Helper::start` would add a parameter to every call for two marks.
- `cargo fmt` isn't used in this repo. Its check fails on files this change didn't touch.
- The public site's environment-variable page lists `ACORN_PERF` for the Node only. It never named
  the helper's lines either, so it wasn't changed. "Configuration files" cites `lib.rs` and still
  matches.

What the owner measures, and what each result triggers:

- Launch the release app through LaunchServices with the lines on:
  `open --env ACORN_PERF=1 --stderr /tmp/acorn-boot.log <path>/acorn.app`. That's the Finder path,
  so the five baseline launches and the shell lines come from the same runs.
- **`keychain` over 50 ms at the median, or any prompt.** Bring the owner two options: read the
  fallback file first when it exists, or sign the build with a stable identity. The first changes
  which store wins, and needs the Rust test under [tests](#tests).
- **A quarantined copy's first launch more than 5 s slower than its second.** The scan runs before
  the process starts, so the lines can't show it. Time from `open` until `[shell:boot] setup`
  appears in the log, once on a fresh download and once after. An ad-hoc copy may be refused
  outright, which is itself evidence. Record the result in [the bundle plan](../bundle.md#sign-macos-artifacts)
  as evidence for notarization, and don't work around the scan.
- **The release `[renderer:boot] script start` over 150 ms at the median.** Work the three steps
  under [fix what crosses its threshold](#fix-what-crosses-its-threshold) in order.
- Rust's `helper spawned` to `helper ready`, minus the helper's own `ready line` offset, is Node
  starting and evaluating the helper bundle before the helper's clock starts. No other line shows it.

Date: October 19, 2026. Status: timing lines landed, release measurements not taken.

Three launch costs exist only in a packaged build, and none has been measured: the keychain read
in front of the helper, the Gatekeeper scan on a downloaded copy's first launch, and the renderer
fetching 151 files over the app's own scheme. This phase measures each one, then fixes only what
crosses its threshold. Read [the programme](./README.md) first.

## Starting point

- The Rust shell blocks in `setup` until the helper prints its ready line, then opens the window
  (`apps/desktop/src-tauri/src/lib.rs`). Everything before the ready line is in front of the window.
  The shell prints no timings of its own.
- `data_key` in `apps/desktop/src-tauri/src/keychain.rs` asks the macOS keychain for the data key on
  every packaged launch, then falls back to a `0600` file. The helper needs that key in its
  handshake, so the read sits in front of the helper's start. While the build is ad-hoc signed, a
  keychain item written by an earlier build can bring up a password prompt, and the window waits for
  the answer.
- A copy downloaded through a browser carries the quarantine attribute, and macOS scans it on its
  first launch. The bundle holds a Node runtime of about 116 MB and thousands of runtime files.
  [The bundle plan](../bundle.md#sign-macos-artifacts) owns signing and notarization.
- The October 17, 2026 renderer build fetches 951,018 B of scripts and 125,792 B of styles at
  startup, in 151 files and one round (`apps/desktop/scripts/check-renderer-budget.mjs`). `serve` in
  `apps/desktop/src-tauri/src/app_scheme.rs` reads each file from disk per request, and marks hashed
  assets as cacheable for a year. Nobody has checked whether WebKit keeps responses from a custom
  scheme between launches.
- The dev app's `script start` mark took 946 ms on October 18, 2026, but that window loads unbundled
  modules from Vite. The release figure comes from phase 1.

## Changes

### Time the shell's own steps

Print `[shell:boot]` lines to stderr behind `ACORN_PERF=1`, the same switch the helper uses, with the
offset from process start and the step's own time. Take marks after the keychain read, after the
helper spawns, at the helper's ready line, and after the window is built. Use `std::time::Instant`
from the top of `run`. These are printed lines only, because the shell has no telemetry of its own.

Add the lines to [the other processes](../../local-development/profiling.md#the-other-processes).

### Fix what crosses its threshold

Run the release build five times as phase 1 describes, and record each cost. Then act on these:

- **The keychain read takes more than 50 ms, or prompts.** Bring the owner the measurement and two
  options. Reading the fallback file first when it exists skips the keychain on machines that fell
  back, which is the common case while the build is ad-hoc signed. Signing the build with a stable
  identity ends the prompts. The first option changes which store wins, so it's the owner's call.
- **The first launch of a quarantined copy takes more than 5 s longer than the second.** Record it,
  and add it to the bundle plan as evidence for notarization. Don't work around the scan.
- **`script start` takes more than 150 ms at the median.** Check these in order, and measure after
  each:
  1. Open the release app twice and read the second launch's `script start`. If it matches the first,
     WebKit isn't reusing the cached responses between launches, and the year-long cache header does
     nothing there.
  2. Serve the startup files from memory: read them once when the shell starts, on a thread that
     doesn't block `setup`, and answer from that copy.
  3. Fetch fewer, larger files by grouping the startup modules into fewer chunks in
     `apps/desktop/vite.config.ts`. The budget check reads module lists as well as chunk names, so its
     denied-name tests keep working. Rerun `pnpm --filter @acorn/desktop build` to confirm.

Stop at the first change that brings `script start` under 150 ms.

## Tests

- A Rust unit test for whatever reorders the keychain read, if the owner picks it. Cover a file and
  no item, an item and no file, and neither.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` for any change to
  `app_scheme.rs`. Its tests cover the content policy, which authorities get served, path traversal,
  and which responses a packaged build caches. A copy served from memory must pass all of them.

## Acceptance

- The evidence page records the keychain time, the quarantine first-launch time, and the release
  `script start`, each before and after any change this phase made.
- Each cost that crossed its threshold was fixed, or the owner decided to leave it, and the page says
  which.
