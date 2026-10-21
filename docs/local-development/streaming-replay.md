# Replay a streamed agent reply

Use this macOS desktop flow to compare renderer costs while the same generated ACP reply streams.
The replay harness runs through the generic ACP driver, normalizer, ledger, broker, and transcript.
`apps/desktop/scripts/agent/replay-fixtures.mjs` generates the replies from a seed. No transcript
text from a person is checked in.

## Run one fixture

Start an isolated session with telemetry on or off. Keep the window visible and uncovered:

```sh
pnpm dev:agent -- --session replay-on --fixture streaming-replay --telemetry on --seed 1
pnpm dev:agent:ui -- --session replay-on replay prose
pnpm dev:agent:ui -- --session replay-on replay code
pnpm dev:agent:ui -- --session replay-on replay tools
pnpm dev:agent:ui -- --session replay-on replay agents
pnpm dev:agent:ui -- --session replay-on stop
```

Each `replay` command opens a fresh managed session, sends one prompt, waits for its turn, checks the
final text's SHA-256 digest against the generated fixture, and samples `streaming`, `settled`,
`idle-focused`, `idle-blurred`, and `hidden`. The `prose` reply has long Markdown and reasoning;
`code` streams 300 lines inside one fence; `tools` mounts 30 completed tool cards. `agents` streams
the `prose` reply into three sessions at once, the way several agents work while one is on screen. It
starts the first two before the `streaming` phase and the third, on screen, inside it, then waits for
all three turns and checks each digest. The fixed delay between ACP updates is 40 ms. Use a separate
`--telemetry off` session for the off comparison.

The JSON report lives in the session's `reports/` directory. It names the machine, viewport,
fixture, phase, renderer, shell, helper, and Node. Each process has CPU time, mean physical memory,
and interrupt wakeups for that phase. The phase-local telemetry rows contain counts and durations
for `markdown.*`, `highlight.*`, `ui.event_loop.delay`, `ui.frame.gap`, and any other recorded seam.
An off run has an empty telemetry list. A failed digest exits nonzero and writes a failure report.
The command also refuses a window that starts hidden.

The sampler uses `proc_pid_rusage` and the automation-only WebKit process diagnostic. The driver
opens Finder for the blurred phase and minimizes the test window for the hidden phase. It checks
the resulting focus and visibility state and restores the window after the run. These controls and
the sampler require macOS. `--prepared` skips desktop staging and rebuilding when you have already
prepared this checkout's assets and debug binary.

## Load the machine

The window is worst when the machine is busy. Add `--load N` to `replay` or `replay-ab` to start `N`
busy processes before the fixture streams and stop them after the `hidden` phase. Each is a Node
child that spins one CPU. `--load` with no number starts one per CPU:

```sh
pnpm dev:agent:ui -- --session replay-on replay agents --load
pnpm dev:agent:ui -- --session replay-on replay prose --load 6
```

The report records the count as `replay.load`, and each phase's one-minute load average as
`loadAverage`. A busy process exits on its own if the harness dies without stopping it
(`apps/desktop/scripts/agent/replay-load.mjs`). The load average lags by about a minute, so the first
phase of a loaded run reads lower than the load it ran under.

## Compare two renderer builds

Build and retain two complete renderer directories, each with `index.html`. Run the A/B command
against one visible `pnpm dev:agent` session without `--vite`:

```sh
pnpm dev:agent:ui -- --session replay-on replay-ab --base /absolute/base-client --candidate /absolute/candidate-client --fixture prose
```

`--load` works the same way here, and each of the four runs starts and stops its own load.

The command stages each renderer in `apps/desktop/dist/client`, reloads the same window, and runs
base, candidate, candidate, base. It writes four run reports and one combined report, then restores
the renderer directory that was present before the comparison. Compare both runs of each build;
if their streaming CPU differs by more than 10%, find the noise source before attributing a change.
Record the dated numbers under `docs/testing/` and keep raw reports outside the repository when
they contain transcript text.
