# Sustained-use and final performance validation

Date: October 1, 2026. Status: pending; run after units 09–28 pass review.
Assignment: one validation specialist or the coordinator, with no concurrent heavy measurements.
Read [the programme](./README.md) and [the contract](./contract.md). This is the final acceptance
assignment, not evidence that a day-long or multi-day stability gate has passed.

Run this gate after all sequential implementation units pass review and final artifacts are staged.
The coordinator owns the run. Keep source/build hashes, workload, settlement intervals, and host
visibility in each result. A bounded run tests repeated-use stability; it does not prove several
days of active work. Preserve the original audit artifacts and each accepted unit comparison.

## Preparation

Run repository lint and the bounded repository test command, including desktop and TUI gates.
Use the separate performance automation bundle, disposable data, and synthetic records. Stop any
prior fixture before rebuilding/staging. Verify exact app/helper/Node identities and record assets.
Attempt the supported test-only focus path once and record native/document visibility and focus.
Hidden runs establish functionality and owner counts only. Never override visibility properties.
Check focus again during transitions and at each sample. Unit06 observes empty plugin regions while
document-hidden, followed by restored content and draft on confirmed native/document focus. A run
that loses focus cannot count blank placeholder snapshots as completed navigation or visible latency.
Record the failed prerequisite and content recovery separately; do not infer focus from a screenshot.

Prepare two authenticated disposable Nodes with equal task/entity IDs to expose mistaken origin
reuse. Include two projects/workspaces, several populated synthetic tasks, Notes, a disposable file
editor, HTTP and database plugin panes, a local preview server, and plain Shell terminals. Create
only the synthetic database objects needed for the real PostgreSQL gate. Do not launch managed
provider sessions, connect an external service, or inspect a normal profile. Use loopback HTTP.

## Repeated-use workload

Warm a fixed set of tasks and surfaces before taking a settled sample. Repeat 200 mixed-use cycles
in batches. In each cycle, switch task and workspace, return to a warmed task, move among compiled
and loaded plugin panes, edit and acknowledge a synthetic Note/file draft, and show/hide a plain
Shell terminal. Periodically open/close a new Shell, dispose/reopen a loaded pane, run bounded local
search, inspect workflow history, and return to prior content. Exercise the second Node and return
to the first with identical IDs. Every transition uses a fresh automation snapshot. Provider-start
controls are excluded explicitly by action selection, rather than relying on an empty provider.

Include isolated adverse sequences: hold a local read/save, switch owners, then settle it; disconnect
and reconnect a disposable Node; return with its cached rows; revoke/restore a synthetic permission;
close a plugin or preview while initialization is held. Preserve failed edits and acknowledge the
exact submitted revision. These sequences verify resource ownership, not server throughput.

Take equivalent settled samples after warmup and at 10, 50, 100, and 200 cycles. Allow the same recorded
idle/grace and persistence windows to finish before each sample. Keep equivalent active terminals,
documents, and plugin bundles at every sample. Do not compare a live-work peak with an idle baseline.
Record successful actions, failures, skipped unsupported surfaces, and screenshots independently
of timing. Inspect representative final screenshots and compare exact synthetic content on return.

## Measurements and interpretation

Record process CPU deltas and elapsed intervals separately; RSS is an operating-system residency
measurement, not live heap. Sample app/helper/Node and precisely attributed WebKit processes where
the available tools can establish ownership. Report omitted processes. Use production-owner probe
counters for listeners, requests, query observers, ports, workers, PTY children, timers, model roots,
and preview listeners. Forced-GC heap results belong to disposable Node/jsdom owner probes unless
the real renderer exposes a supported collector. String lengths and DOM attributes are not heap.

The fixed visited set should settle to the accepted owners' bounds. Warm cache/document data can
remain by contract; zero retained bytes is not the goal. Run a separate expanding visited-set case
to distinguish deliberate cache/recovery retention from leaked views. Preserve offline queries,
dirty text, canonical results, and durable terminal state. Do not lower content budgets or clear
state to make a chart plateau. Investigate any growing retired-owner count before claiming success.

Only a continuously visible/focused run can measure navigation paint or ready-content latency.
Record actual target content readiness in addition to seam timings. Sentry release-less historical
spans and hidden-window timings cannot supply a matched final before/after comparison. Report unit
CPU/memory/operation improvements with their workloads if a native timing gate remains unavailable.

## Terminal composition and cleanup

Run the actual TUI through disposable PTY/fake-TTY input, including two-Node selection, hidden list
reveal, keyboard/page movement, repeated panes, and scoped plugin calls. Inspect captured cell output.
Verify startup deferred roster, correct selected cache/status, dirty outgoing persistence, and quit
ownership of supervised versus attached Nodes. The synthetic frame probes establish wrapping and
painting CPU; they do not establish a user's terminal emulator latency.

Close owned sessions/listeners and stop every fixture app, Node, database, HTTP server, preview,
worker, and descendant. Verify recorded PIDs and port owners are gone. Run final diff/contract/docs
checks and summarize accepted improvements, measured regressions/tradeoffs, conditional findings,
and remaining evidence limits. Retain sanitized artifacts and a command/result index for review.

## Verify before building

- Confirm every selected implementation unit has review and a reproducible evidence record.
- Rebuild final artifacts, verify source/build hashes, and stop older fixture sessions first.
- Check actual native and document focus rather than inferring it from screenshots.
- Establish exact ownership for both authenticated disposable Nodes and all fixture processes.
- Compare equivalent warmed active owners and settlement windows at every sample.
- Preserve dirty work, offline content, and canonical results when investigating growth.
