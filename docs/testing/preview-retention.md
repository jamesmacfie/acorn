# Preview retention acceptance

The shell retains a document when `ensure` receives the same normalized home and policy.
For the lifecycle, scheduling policy, and recovery matrix, see
[Host-owned webviews](../shell.md#host-owned-webviews).

## Reproduce the native trial

Start an isolated session with `pnpm dev:agent -- --session preview-retention`.
Run `node apps/desktop/scripts/agent/preview-fixture.mjs` to start a loopback fixture and record its
reported URL. Run
`node apps/desktop/scripts/agent/preview-retention.mjs preview-retention http://localhost:PORT 360000`
with that URL. The trial uses the platform seam in a real Tauri window. Its wait runs in the automation shell,
so background scheduling of the main renderer does not control the trial duration. It checks 50 normalized
returns, redirects, six owners, a six-minute hidden interval, home changes, explicit reload, plugin
grant replacement, and the shared 32-view ceiling. Finish with
`pnpm dev:agent:ui -- --session preview-retention stop`.

The fixture contains a document incarnation marker, a synthetic unsaved form value, a scrollable
1,500-row table, and a dashboard that fetches application data every second while active. Reports
separate main-document requests, activity reports, and application-data requests. Fixture scripts
seed form and scroll state; this is not evidence of manually entered state.

The automation build's `webview_diagnostics` command records exact WebKit content-process IDs and
physical footprints on macOS. Sum each process ID once. Shared GPU and networking processes require
separate operating-system measurements; a sum of content-process footprints is not total app memory
or an estimate of individual page memory. The command is absent from production builds and adds no
page bridge or telemetry.

The pinned WebDriver plugin enumerates `webview_windows()`, which excludes a main window after a child
webview is added. Subsequent renderer-driver requests can fail with "No window could be found".
The trial holds one executor for its whole lifecycle and disposes its views before returning. Use
native computer-use for interaction inside the preview. The normal driver cannot inspect that page.

## Delivery evidence

The October 1, 2026 trial uses Mac14,10 hardware with 32 GiB memory, macOS 27.0, Tauri 2.11.5,
tauri-runtime-wry 2.11.4, and wry 0.55.1. The synthetic dashboard provides a repeatable development
workload. It is not a measurement of a production application, live sockets, or media playback.

Focused coverage includes normalized home reuse, meaningful URL changes, failed navigation retries,
toolbar replay after observer registration, scoped cleanup, pending and absent URLs, remote-preview
refusal, stale target completions, Node-switch retirement, plugin retirement ordering, and grant
replacement. The bounded full suite passes using supported Node 26.8.1. Node 24.11.0 fails the
repository's runtime security floor and must not be used for loaded-plugin acceptance.

Native computer-use attached to the temporary isolated app bundle but failed input with an activation
error. Renderer snapshots confirmed the preview affordance and a real native fixture load. The final
main-window screenshot, `preview-retention-final/screenshots/after-retirement.png` under the session
root, confirms that the renderer remains usable after child disposal. Manual child-page interaction,
child-page screenshot review, and Windows and Linux graphical acceptance remain
unverified. Browser content-process loss cannot be observed through the pinned Tauri API; no recovery
reason is inferred from ordinary page loads.

### Short native trial

The `preview-retention-measure` session completed a 30-second hidden interval. Its report is
`.acorn/agent-dev/preview-retention-measure/reports/preview-retention.json`; operating-system CPU
samples are in `process-samples-final.jsonl` beside it. These isolated local artifacts are ignored
by Git. The following values are deduplicated physical footprints in MiB, rounded to one decimal.
Snapshots immediately after creation include pages still allocating their document resources.

| Phase | Live child views | Live child process footprint | Main and live child process footprint |
| --- | ---: | ---: | ---: |
| Before opening | 0 | 0.0 | 83.9 |
| One active lightweight page | 1 | 10.5 | 94.5 |
| After 50 returns | 1 | 29.0 | 114.1 |
| Retained nested route after a redirect | 1 | 35.9 | 120.7 |
| One active dashboard and five hidden pages | 6 | 182.4 | 267.0 |
| All six hidden | 6 | 182.5 | 267.1 |
| After 30 seconds hidden | 6 | 171.2 | 255.8 |
| Dashboard returned | 6 | 171.2 | 255.8 |
| Changed home | 6 | 185.2 | 269.8 |
| Explicit reload | 6 | 186.8 | 271.5 |
| Shared ceiling reached | 32 | 770.6 | 855.8 |
| After disposal | 0 | Not attributable through handles | Main only: 85.3 |

Across a 24.753-second sampled portion of the hidden interval, the seven attributed content
processes consumed 0.52 CPU seconds, about 2.1% of one core. The dashboard made six data requests
during the 30-second interval, then stopped polling while suspended. This is a short synthetic
sample, not a steady-state CPU estimate. GPU and networking processes were present in the system
samples, but their ownership was not established, so the table excludes them.

Disposal removes all native view handles, but does not immediately terminate their WebKit processes.
All 32 previously attributed child process IDs remained in operating-system samples for at least
24.6 seconds after disposal. Their combined resident set was about 470.5 MiB at that point. Resident
set size and physical footprint measure different things; do not add this value to the table or
interpret the missing handles as zero residual browser memory. The engine controls process reuse
and reclamation after the views close.

The navigation trace records one initial document request and zero additional requests over 50
same-home returns. Explicit redirect navigation records the redirect and destination requests.
Returning to that route records zero requests. Hiding and returning the dashboard records zero
requests, with one document incarnation, the seeded form value, and scroll position 333 preserved.
Changing the configured home and explicitly reloading each record one document request. The 33rd
view is refused without evicting a retained owner. Plugin reuse, grant revocation, replacement,
and explicit retirement complete through the shared native seam.

### Long native trial

The `preview-retention-long` session records a 360.096-second hidden interval in
`.acorn/agent-dev/preview-retention-long/reports/preview-retention.json`, with CPU samples in
`process-samples.jsonl`. All six native owners remain present. Their deduplicated child content
footprint changes from 176.1 MiB when hidden to 173.8 MiB after the interval, and remains 173.8 MiB
after the dashboard returns. Main and child content footprint totals 268.7 MiB after return.

Across 358.052 seconds of operating-system samples, the seven attributed content processes consume
3.47 CPU seconds, about 0.97% of one core. The dashboard makes 68 application-data requests during
the interval. Background polling slows but continues in this run. The trace records zero document
requests throughout hiding and return. Its dashboard reports retain one incarnation, the seeded
form value, and scroll position 333.

The native run returns its complete lifecycle report, but the original redirect assertion fails:
the trial treats an accepted navigation URL as a completed load, and the destination request arrives
22 milliseconds after that phase begins. The trace contains one redirect and one destination request,
with no second destination load caused by the return. The trial now waits for a loading-to-finished
transition and filters requests by fixture owner before checking a return. This distinction prevents
an in-progress redirect or another owner's first load from counting as a retention failure.

The corrected `preview-retention-final` trial passes with a 30-second hidden interval. It verifies
zero additional document requests over 50 returns, zero requests on the redirected-route return,
zero requests on the hidden-dashboard return, grant replacement, and capacity refusal. Native
view count grows from one main view to 33 views at the shared ceiling, then returns to one main
view after family retirement. This run uses the final bridge and shell implementation.

### Cache recommendation

Keep default browser scheduling and explicit retirement for this delivery. Six retained fixture
pages cost about 171-182 MiB of child content memory in the short trial. Creating 32 pages reaches
about 771 MiB before shared browser resources, so the creation ceiling is a safety bound rather than
a recommended working set. Removing repeated navigation does not make retained pages free.
Closing views also does not guarantee immediate process-memory reclamation.

Do not choose an automatic inactivity or least-recently-used policy from this workload alone.
Measure real development applications and attribute shared browser resources on each supported
platform before selecting a smaller cache. If resource pressure warrants a follow-up, start with an
explicit **Close preview** control. It should retire only the selected owner and explain that closing
discards unsaved page state and ephemeral storage. Automatic eviction needs a documented pressure
trigger, platform support, and the same state-loss disclosure.
