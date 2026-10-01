# Performance audit contract

The user requests a thorough performance investigation followed by measured fixes. The coordinator
runs one specialist agent at a time. All 16 area reports precede implementation. This is area-specific
analysis, not permission to change application source or start more agents.

## Repository and constraints

Work in `/Users/jamesmacfie/Source/acorn/apps/node/.acorn/worktrees/jamesmacfie-acorn-performance`.
The baseline is `f8e4b59c`. Do not create branches, commits, or subagents. Prefix shell commands with
`rtk`, using `rtk proxy` when raw output is needed. Read the relevant source before proposing changes.
Trace ownership, callers, data transformations, boundaries, disposal, and the UI that consumes it.

Application source remains read-only during investigation. Write your full report to the assigned
file under `plans/performance/`. Keep reproducible measurement scripts and sanitized results beside
the report, or provide `/tmp` paths for the coordinator to preserve. Experiments can use disposable
data and ignored artifacts. Do not inspect or alter a normal development profile. Do not expose
credentials or private user content. Use synthetic records and operation counts where possible.

Preserve baseline measurements under `before` names. Give probes an output tag or path, defaulting
to `sample`, so later replay cannot overwrite them. A replay after implementation must invoke the
new production owner; benchmarking an imported library path that production no longer uses does
not establish the fix's effect. Source-only correctness constraints need explicit fail-before cases.

## Context to read

Read `docs/README.md`, `docs/architecture-overview.md`, `docs/conventions.md`, the documents owning your
area, and relevant proposals indexed by `docs/future/README.md`. Future proposals are not shipped
contracts, but proposed optimizations must not make their extension or isolation boundaries harder
to support. Read the Performance and Finding format sections in
`/Users/jamesmacfie/.agents/skills/improve/references/audit-playbook.md`.

Desktop flow: Solid renderer -> platform WebSocket -> Node helper custody broker -> pinned TLS and
device authentication -> Node API -> core or plugin storage/runtime. Events return through the Node
WebSocket, broker, fanout, cache/store, and visible UI. Rust owns windows and child webviews. Nodes
own their data and execution environments independently. The TUI shares client-core while composing
custody in process. Loaded Node plugins use permission-scoped workers. Loaded UI uses component trees
or sandboxed frames. Preserve these boundaries and contribution/capability seams.

## Prior work and verification

Read relevant Git history. September 25-26 changes include retained terminals and bounded WebGL
contexts, incremental transcript projection, bounded agent snapshots, narrower stream invalidation,
event resume/folding, conditional Git patch hydration, shared numstat reads, concurrent worker startup,
reply-buffer reuse, compile caching, bundled JavaScript dependencies, lazy UI/ACP imports, and stable
kit slots. Evaluate the code on the branch. Reject suggestions already implemented.

Dependencies, SDK outputs, and desktop/service artifacts are prepared. Baseline `pnpm lint` and the
bounded `pnpm test` passed, mostly using Turborepo caches. Coordinate builds and heavy tests with the
coordinator so benchmarks do not compete with them. Run focused measurements against actual owners.
Do not add tests or instrumentation to source during the audit. Source-loading benchmarks can use
`node --import tsx`, with a browser condition or the package's Vite/Vitest configuration when Solid
requires the client build.

An isolated Tauri session named `perf-baseline` is running. Six tasks belong to a disposable non-Git
project at `/tmp/acorn-performance-fixture`. Its logs, manifest, and screenshots live under
`.acorn/agent-dev/perf-baseline/`. Coordinate live-session changes before making them. Sandboxed local
IPC and WebDriver calls can require automatic escalation. `plans/performance/live-probe.mjs` reads
renderer counters and seeds tasks; `resource-probe.mjs` reads the app's CPU and RSS subtree.

The renderer reported hidden/unfocused during reconnaissance. A screenshot verified layout, but
animation-frame and navigation elapsed times are not valid visible-latency measurements while hidden.
Use CPU, operation counts, bounds, transfer sizes, and retained heap where appropriate. Ask the
coordinator about window visibility before relying on UI timing. Do not equate a short synthetic
stress test with a full day of actual use.

Sentry organization `acorn-u3`, project `acorn-development`, region `https://us.sentry.io` has recent
spans. Release identifiers are absent in the inspected records, and large elapsed tails may include
suspension. Request particular evidence from the coordinator or inspect relevant tools if useful.
Treat telemetry as a lead, not proof that a sampled span came from this checkout.

## Report

Provide inspected modules and the source-to-consumer flow, relevant prior changes, findings with
`file:line` evidence, impact, confidence, effort, risk, and a specific fix sketch. Include before
measurements or an exact verification recipe, behavioral invariants, future-plan compatibility,
considered/rejected ideas, and scope that could not be measured. Distinguish facts from estimates.
Do not pad the report with speculative caching or weakened correctness guarantees.

Complete the report when the owning paths and concrete candidates are covered. Retain useful
measurements; avoid repeating optional benchmarks after the remaining uncertainty is resolved.
Return a concise summary, the report path, actionable findings, and validation gaps. Send concrete
progress to the coordinator during the work.
