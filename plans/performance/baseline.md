# Verification baseline

Recorded September 30, 2026, at `f8e4b59c` before source changes.

## Build and checks

The checkout initially had no installed dependencies. `pnpm install --frozen-lockfile` completed
with Node 24.11.0 and pnpm 11.0.0 after the sandboxed registry request failed DNS resolution.
`pnpm lint` passed: 34 package typechecks completed, and oxlint reported warnings without errors.
Turborepo reused 33 cached package checks. Final checks must also cover modified packages.

`pnpm test` also passed: 35 task groups completed, including the desktop build, 112 desktop
TypeScript tests, and 40 Rust tests. Turborepo reused 34 groups. The complete run took 39.55 seconds.
Cached groups are not fresh sustained-use experiments; each changed package needs relevant tests
after its implementation, followed by the final bounded suite.

The first isolated desktop launch failed during bundled-plugin staging because the SDK exports
point to absent build outputs. `pnpm --filter acorn-plugin-sdk build` produced those ignored
outputs. This is a checkout preparation issue, not evidence of application startup latency.

## Sentry observations

The inspected development spans have no release identifier. The September 26 cutoff narrows the
time range but cannot prove which checkout produced a span. Suspension can affect elapsed times.
These values identify investigation targets and are not before-and-after measurements.

| Span | Samples | Median, ms | 95th percentile, ms |
| --- | ---: | ---: | ---: |
| renderer.boot | 28 | 654.5 | 2,162.9 |
| helper.boot | 5 | 3,582.0 | 4,688.1 |
| agents.session.open | 566 | 158.0 | 30,000.2 |
| agents.sidebar.open | 474 | 108.6 | 3,287.2 |
| cache.serialize | 5 | 608.0 | 9,257.0 |
| cache.write | 269 | 216.5 | 1,380.0 |
| highlight.main_thread | 59 | 244.0 | 1,282.2 |
| diff.segments.enrich | 78 | 210.0 | 1,147.2 |

For the sampled results, see the [Sentry performance query](https://acorn-u3.sentry.io/explore/traces/?query=timestamp%3A%3E%3D2026-09-26&project=4512064444825600&statsPeriod=7d&table=span).
A [September 30 Node request](https://acorn-u3.sentry.io/explore/traces/trace/6302367d354571686154b42646be7da1)
took 436.5 ms and contains one span, so its trace overview provides no causal breakdown.

A route-grouped query later in the audit identified additional server leads. The same release and
suspension limitations apply; these are not checkout-specific baselines.

| Route family | Samples | Median, ms | 95th percentile, ms |
| --- | ---: | ---: | ---: |
| core task-statuses | 3,132 | 346.6 | 1,797.0 |
| Docker task-summary | 2,302 | 445.1 | 2,672.0 |
| agents providers | 379 | 218.0 | 1,589.5 |
| agents usage | 574 | 0.7 | 9,695.5 |
| task tools | 79 | 342.3 | 921.7 |
| agent event pagination | 32 | 133.4 | 1,247.0 |
| local Changes status | 24 | 305.8 | 3,120.6 |

See the [route-grouped Sentry query](https://acorn-u3.sentry.io/explore/traces/?query=timestamp%3A%3E%3D2026-09-26+span.description%3Ahttp.request&project=4512064444825600&statsPeriod=7d&table=span).

## Live workload

Use isolated session `perf-baseline`; its profile, logs, and screenshots live under the ignored
`.acorn/agent-dev/` directory. Record cold and established-profile startup separately. Seed test
tasks in a disposable local project, exercise task and workspace switches, open and close plugin
panes and terminals, and compare resource counts and memory after repeated cycles and idle time.
Do not include dependency staging or Rust compilation in application launch timings.

The first session's helper ready mark was 134 ms, and Node adoption was 742 ms on the helper clock.
The renderer reported script evaluation at 161 ms and `nodeReady` at 220 ms on its navigation clock.
Its document was hidden and unfocused, so the recorded first-paint mark cannot establish visible
paint latency. A WebDriver screenshot verified the staged layout, and the broker successfully seeded
six tasks under `/tmp/acorn-performance-fixture`, which is not a Git repository.

An idle sample after opening one task recorded shell RSS 84,448 KiB, helper RSS 39,184 KiB, and Node
RSS 56,288 KiB. The Node reported 0.2% CPU, with a Docker child at 0.1%. These are single samples,
exclude WebKit processes outside the app subtree, and include shared resident pages. They do not
establish total physical footprint or prove long-session stability.

After roughly another half hour with the same task open and no additional UI workload, shell RSS
was 84,016 KiB, helper RSS 44,688 KiB, and Node RSS 67,072 KiB. Cumulative CPU times were 2.15,
2.37, and 8.49 seconds respectively. This quiet interval is useful background context; it does
not exercise the request and component churn reproduced by the specialist benchmarks.

At 2026-09-30 11:52 UTC, the renderer remained hidden and unfocused, with 414 DOM elements and no
xterms. The app subtree also included an agent-provider CLI and MCP grandchildren, so this sample
is not a quiet baseline. Their cause was not established and they were not altered. The Node RSS
was 62,496 KiB with 19.77 seconds of cumulative CPU. Future whole-app comparisons must distinguish
provider activity from shell, helper, and Node housekeeping.

## Continued idle sample during investigation

At `2026-09-30T12:51:38.850Z`, the original isolated session remained running. RSS was
84,512 KiB for the shell, 37,040 KiB for the helper, 59,120 KiB for the Node, and 43,824 KiB
for its Docker child. Cumulative CPU was 8.88 s, 8.20 s, 30.03 s, and 38.74 s respectively.
No provider CLI appeared in this sample. These are observations from a mostly idle hidden window;
RSS includes shared pages and excludes WebKit processes outside the process subtree. They do not
establish memory bounds during active work or multi-day responsiveness.

An [agent-specific Sentry query](https://acorn-u3.sentry.io/explore/traces/?query=timestamp%3A%3E%3D2026-09-26+span.description%3Aagents.*&project=4512064444825600&statsPeriod=7d&table=span)
returned 574 session-open spans (median 157.9 ms, p95 30,000.8 ms), 482 sidebar-open spans
(106.9 ms, 3,225.6 ms), and 29 subagent-open spans (43.0 ms, 78.5 ms). Three transcript-project
spans and one transcript-visible span had elapsed tails lasting minutes. Their sparse, unattributed
elapsed values cannot establish projection CPU and require source-owner measurements.

## Terminal navigation baseline

On the disposable project's first task, the real Tauri driver opened a shell in
`/tmp/acorn-performance-fixture`, switched to task 2, and returned to task 1. The same terminal
remained available with its prompt and scrollback. The screenshot
`.acorn/agent-dev/perf-baseline/screenshots/terminal-before.png` was visually inspected. No managed
agent turn was started. The renderer had 487 DOM elements and one xterm and remained hidden and
unfocused; these transitions establish functionality, not visible latency.

At `2026-09-30T14:16:12.626Z`, shell/helper/Node RSS was 50,672/41,072/102,816 KiB, with cumulative
CPU 14.53/12.46/45.33 s. The Node's Docker child used 39,472 KiB and 57.89 s cumulative CPU; a
shell child used 4,112 KiB. This sample follows terminal creation, so it is not equivalent to the
earlier no-terminal idle sample. The same shared-page and WebKit exclusions apply.

At `2026-09-30T15:52:41.116Z`, the same shell/helper/Node used 46,688/42,208/74,592 KiB RSS,
with 21.41/16.95/62.30 seconds cumulative CPU. Docker used 40,144 KiB and 79.47 seconds CPU;
the retained shell child used 1,280 KiB. Relative to the preceding sample, the roughly 96-minute
quiet interval added 6.88/4.49/16.97 seconds CPU to shell/helper/Node and 21.58 seconds to Docker.
This remains a mostly idle, hidden-window observation rather than an active all-day stress test.

## Original source for paired owner measurements

The coordinator archived commit `f8e4b59caadfe846a9e2c6491ac42b91ec3cf66f` to
`/tmp/acorn-perf-original-f8e4b59c`. No branch or checkout mutation was needed. A frozen offline
install stopped because the local package store lacked the `drizzle-kit` tarball. The archive
instead uses copies of the 35 installed workspace dependency layouts, with their relative
symlinks preserved, and the checkout's installed external dependency store. All 165 `@acorn`
workspace links resolve inside the archive. Both original startup owners import successfully.

Paired source probes run each variant from its own source root under Node `v24.11.0`, with the
same staged bundled-plugin bytes. The external dependencies are shared; Acorn source is separate.
This setup establishes owner-level comparisons and does not create a separately built native
baseline. Preserve the original evidence and use distinct output names for implementation runs.
