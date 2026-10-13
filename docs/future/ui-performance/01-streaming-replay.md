# Phase 01: streaming replay

Completion note, October 13, 2026: The generated `prose`, `code`, and `tools` ACP fixtures, data-only
replay harness, desktop flow actions, macOS process sampler, phase-local renderer histograms, and
base/candidate/candidate/base command landed. A real desktop `tools` turn completed and matched its
ledger digest. The renderer histogram probe also returned phase-local rows in a Vite-backed window.
The A/B command takes two prepared renderer directories so it can reload one window without building
inside the timed run. An agent-launched app always has a hidden window, so the visible-window
baseline needs a person at the machine. The replay command correctly refused to measure that hidden
window. The dated check is in
[streaming replay check](../../testing/streaming-replay-2026-10-13.md). Later phases must collect the
visible baseline for all fixtures and telemetry modes before claiming a performance change.

Status: tooling landed; person-run baseline pending, October 13, 2026.

Read the [programme page](./README.md) first. It holds the measuring rules every phase follows.

## Deliverable

One command streams a recorded agent reply into a visible `pnpm dev:agent` window at a fixed pace,
waits out an idle period, and writes a report. The report gives each phase's renderer CPU, physical
memory, and wakeups, plus Acorn's own work timings from inside the window.

## Why this comes first

Acorn's transcript numbers come from jsdom and from Sentry. jsdom says what the code does, not what
WebKit spends painting it. Sentry says what happened to someone, with an unknown reply and an unknown
machine. Neither can tell you whether a change made streaming cheaper. Zeron runs every performance
change through the same recorded reply in the same window size, in alternating order, and quotes the
spread between runs. This phase builds that for Acorn.

## Starting point and owners

- `apps/desktop/scripts/agent/flow.mjs` runs data-only flows from `apps/desktop/scripts/agent/flows/`
  and writes JSON reports. It already refuses a hidden window.
- `apps/desktop/scripts/agent/seed.ts` seeds fixtures. The large-surface fixture's `canonical` profile
  holds a 7,012-event session ([desktop tests](../../testing/desktop.md#the-large-surface-fixture)).
- A contributed ACP harness is data: a launch spec the generic driver runs
  ([harnesses](../../managed-agents/harnesses.md#two-driver-tiers)).
- `packages/client-core/src/kit/lib/telemetry/workTelemetry.ts` records `measureWork` timings such as
  `markdown.render` and `markdown.parse`. `packages/client-core/src/infra/highlight/shiki.ts` records
  `highlight.html.render`.
- `packages/client-core/src/infra/telemetry/responsiveness.ts` records `ui.event_loop.delay` and
  `ui.frame.gap`.

## Design

### A replay agent

Write a small ACP agent program. It answers `initialize`, `session/new`, and `session/prompt`, then
plays a fixture's list of `session/update` notifications at a fixed delay and ends the prompt. Install
it in the session's data root as a data-only loaded harness package, the way an outside harness is
installed.

This path runs the real ACP driver, normalizer, ledger, 40 ms text coalescing, broker, client store,
and transcript. Two other choices were considered and refused:

- `FakeAgentDriver` in `plugins/agents/src/server/drivers/fake.ts` skips the ACP driver and normalizer,
  so its numbers miss real work.
- A real Claude or Codex turn varies in length and pace, costs money, and can't be repeated exactly.
  Zeron's live-provider runs disagreed with its replay runs for this reason.

Keep the agent and its fixtures beside the flow runner, not in a shipped package.

### Fixtures

Generate the fixtures from a seed, as the large-surface fixture does, so no real transcript is checked
in. Three replies cover the phases:

- `prose`: about 50 KB of Markdown text and reasoning, for phases 03 and 05.
- `code`: a reply that streams a 300-line fenced code block, for phase 02.
- `tools`: a reply with 30 tool calls and their output, for card mounting.

Each fixture records its delay and a digest of the final reply text. A run whose final text doesn't
match the digest fails, so a broken replay can't produce a good-looking number.

### Flow steps

Add the steps a replay needs to the flow runner's fixed list. A flow stays data. Suggested steps:

- `send`, which fills the composer and submits it, using the existing `fill` and `click` targets.
- `waitTurn`, which waits for the session's turn to reach `completed`.
- `measure`, which samples for a set number of seconds and labels the phase, such as `streaming`,
  `settled`, `idle-focused`, `idle-blurred`, and `hidden`.
- `switchSession`, which opens another seeded session and returns, for phase 04.

### Sampling

Sample each process on its own: the WebKit content process that runs the renderer, the Tauri shell,
the helper, and the Node. On macOS, `proc_pid_rusage` gives CPU time, physical footprint, and
interrupt wakeups without root. Zeron's `references/zeron/scripts/macos-resource-stat.c` is a
working example. Physical footprint matters more than resident memory on macOS, because it includes
compressed and graphics memory.

Inside the window, read the `measureWork` and `highlight.*` histograms, `ui.event_loop.delay`, and
`ui.frame.gap` per phase through the WebDriver execute route. WebKit has no Long Tasks API, so use the
event-loop delay instead.

### Comparing two builds

A `pnpm dev:agent` window reads the staged renderer from `apps/desktop/dist/client` on each request.
Rebuilding the renderer and reloading through WebDriver switches builds in one window. Add an A/B
mode that stages two renderer builds, runs base, candidate, candidate, base, and writes one report
with all four runs.

## Implementation steps

1. Write the replay agent and the `prose` fixture. Install it in a `pnpm dev:agent` session by hand
   and stream one reply.
2. Add the `send`, `waitTurn`, and `measure` steps and a `streaming-replay` flow.
3. Add per-process sampling and the in-window histograms to the report.
4. Add the `code` and `tools` fixtures and the `switchSession` step.
5. Add the A/B mode.
6. Document the command in [agent drivers](../../local-development/agent-drivers.md) and
   [profiling](../../local-development/profiling.md).
7. Record a baseline for all three fixtures in a dated page under `docs/testing/`.

## Acceptance

- One command runs a fixture end to end and exits non-zero on a digest mismatch or a hidden window.
- Two runs of the same build land within a spread the baseline page records. If streaming CPU varies
  by more than 10% between identical runs, find the noise source before using the numbers.
- The report separates the renderer, shell, helper, and Node, and labels each phase.
- The baseline page records `streaming`, `settled`, and the three idle phases for each fixture, with
  telemetry on and off.

## Limits

- One machine and one window size per run. Record both with the numbers.
- A frame gap is a chance to paint, not proof that pixels reached the screen.
- Replay covers text, reasoning, and tool events. Permission and question cards need the real
  harness or the `unattended-policy` fixture.
