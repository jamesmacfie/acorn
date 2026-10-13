# Streaming replay check, October 13, 2026

This page records the first real-window attempt for the generated ACP replay. It is a diagnostic
record, not a performance baseline: the test window reported `document.visibilityState: hidden`,
so the measurement command refused to run.

## Machine and run

- Host: macOS, Apple Silicon. The WebKit viewport reported 1440 by 900 at device pixel ratio 1.
- Session: `pnpm dev:agent` with the `streaming-replay` fixture, seed 1, and telemetry on.
- The data-only `streaming-replay:replay` harness loaded and opened a managed session.
- A `tools` prompt sent from the real composer completed through ACP. The stored reply was 711
  bytes, and its SHA-256 matched the fixture digest
  `750760d860b453c903c02996744966c177858984a89f7d863f7699d414c08803`.
- The process diagnostic identified distinct WebKit content, Tauri shell, helper, and Node PIDs.
  The macOS sampler read CPU time, physical footprint, and wakeups for each.
- A Vite-backed renderer build returned phase-local `cache.*`, `api.*`, `agents.*`, and `pane.*`
  histograms through the WebDriver event. This checked the collection path, not a timed baseline.

The window stayed hidden after `open -a` brought its test app forward. Computer Use could not find
a Core Graphics window for the app. The replay command stopped at its visibility check before
streaming, as intended. No hidden-window numbers are used as a baseline.

## Measurements still required

Run the command in [streaming replay](../local-development/streaming-replay.md#run-one-fixture)
with a visibly foregrounded window. Capture two runs for each fixture and telemetry mode, and record
all five phases. Then run base, candidate, candidate, base for any proposed renderer change. Quote
both runs of each build and investigate streaming CPU spread above 10% before using the comparison.
