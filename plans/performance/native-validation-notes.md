# Native validation follow-up

Status: cumulative units 01–05 replays paint Notes and a plain Shell in inspected screenshots.
The units 01–06 API replay paints the actual HTTP regions and preserves the draft after one confirmed
native/document focus recovery. Reliable focused repeated navigation remains unavailable; the original
baseline terminal transition also times out. These records establish functional observations and
limits, not a matched visible latency improvement. Do not launch or alter a normal Acorn profile.

The documented agent launcher starts a bare debug executable. macOS computer-use inventory did not
identify it as a running application. The separate debug `.app` bundle and supported SDK focus path
below resolve activation for the owned fixture. Computer Use remains unavailable after its stalled
calls; continue with the bounded renderer driver and test-only SDK focus commands. Do not select or
start a normal installed app.

If a visible baseline is needed after source changes, `git archive` of original `f8e4b59c` into a
disposable `/tmp` directory can produce a separate original build without a branch or checkout
mutation. Install the frozen dependencies with workspace links rooted in that archive; do not
reuse workspace symlinks pointing at the modified source. Keep baseline and changed builds,
isolated profiles, artifacts and timing labels distinct. Run them sequentially on the same host.

Any separate launcher remains a test artifact and mirrors the repository's seeding, environment,
private manifest, WebDriver setup and final cleanup. Inspect supported local Tauri CLI arguments
before bundling. Packaging/build time is not application startup time. A distinct test bundle ID
can prevent selecting another installed app, but record that metadata difference in measurements.
Native child webview navigation and Node identity require native control; the main renderer driver
does not cover those surfaces.

The earlier attempts described below did not verify activation. The later supported focus path does,
but supplies no valid terminal transition timing. Every timed run must confirm that its own renderer
is visible/focused and uses the correct isolated app. Stop test sessions and owned fixture services
at completion, retaining only sanitized evidence.

## Test bundle attempt

The installed Tauri CLI accepts `bundle --debug --features agent-automation --bundles app --ci`.
`native-before.conf.json` gives the test bundle a distinct name and identifier, without updater
artifacts. Bundling the already-built debug executable succeeded without rebuilding or staging.
`native-session.mjs` mirrors the agent launcher's isolated environment, private manifest, seed,
WebDriver session, logs, and cleanup. It launches only an explicit automation executable.

The original bare `perf-baseline` session stopped on September 30 at 17:33 UTC. A fresh
`perf-visible-before` profile launched the test bundle. Native inventory confirmed that exact
bundle running. Its renderer still reported hidden and unfocused. The native app-selection call
stalled for 4,615 seconds, then returned window metadata. The observed Raise action stalled for
1,750 seconds, then refused because Computer Use was inactive and requested `get_app_state`.
That tool is absent from enabled metadata. No normal app/profile was selected or changed.
Further native activation attempts are suspended; the documented renderer driver remains usable.

This debug bundle resolves resources from the checkout's staged paths. Its embedded resource copy
does not freeze the baseline for a later restart after staging changed assets. Stop it before
replacement staging; use a separate original-source build if a later original native replay is
needed. The launch and packaging times do not establish startup or visible navigation performance.

The coordinator stopped `perf-visible-before` through the documented driver before replacement
staging. Its launcher completed with exit code zero. The final task-return check restored Notes
and the same terminal tab, with one xterm. The bundled window's terminal canvas remained blank in
the inspected screenshot, so that run does not establish prompt painting. The original bare
session's inspected screenshot contains the prompt and scrollback. Neither run establishes
visible navigation latency.

## Supported focus path

Source inspection finds a `main` webview/window created by `open_window` in the Rust shell, and a
Rust focus call at `RunEvent::Ready`. The generated installed Tauri access manifest grants the main
renderer window visibility/focus queries through `core:default`, but does not grant `set_focus`,
`show`, or `unminimize`. Calling those commands from the renderer driver would therefore require a
test-only, main-webview-scoped capability in a separate automation bundle. Do not widen the
production capability or grant plugin/preview webviews access. Inspect the installed SDK and
configuration schema first, and verify actual OS and document focus rather than overriding browser
visibility properties.

The coordinator executed this path with `native-focus.conf.json`, which keeps the production
capability file intact and adds four activation permissions only to `main` in a distinct
`com.acorn.performance.automation` test bundle. The installed SDK and Rust configuration sources
confirm the IPC verbs and inline capability support. A debug automation build completes in
1 min 56 sec with the frontend build hook disabled. No JavaScript assets are rebuilt or staged.
The original staged resource counts and hashes are preserved in
[the asset record](./evidence/native-focus-before-assets.json).

The disposable `perf-focus-before` session runs that bundle. `native-focus.mjs` checks the bundle
identifier before invoking app show and main-window show, unminimize, and focus. Its driver requests
have deadlines. [The state record](./evidence/native-focus-before-state.json) reports native visible
and focused both true, and document visibility `visible` and focus true. No browser property is
overridden. This establishes a supported activation path despite the unavailable Computer Use
actions.

Fresh driver snapshots show Home, synthetic task creation, and Notes. No managed session is started.
Opening the terminal drawer then times out in the element-click driver command, and the following
snapshot also reports script execution timeout. A screenshot attempt does not complete before
shutdown. The owned shell/helper/Node/Docker process sample reports 0.0/0.0/0.4/0.2 percent CPU;
separate WebKit processes are outside that subtree. The private test log has no panic, error,
denial, or failure keywords in the inspected 78 lines. These observations do not identify the
cause or establish a CPU regression.

The coordinator stops the session through the documented driver. The launcher exits zero, and all
four recorded descendant PIDs are absent afterward. No focused terminal screenshot or valid
navigation timing is claimed. Repeat the activation and functional checks against the final staged
build, with bounded driver requests and actual screenshot inspection. Builds and test metadata
remain separate from startup timings.

## Cumulative pre-navigation replay

After units 01–04 pass the staged desktop gate, the coordinator launches `perf-focus-pre05` against
those staged assets in the separate automation bundle. The asset record is
[native-focus-pre05-assets.json](./evidence/native-focus-pre05-assets.json). It is a cumulative
checkpoint, not another original-source baseline.

Two SDK activation attempts report native visibility true but native focus false, document focus
false and document visibility hidden. Both state artifacts remain in `evidence/`. The coordinator
does not override those properties or claim visible latency. The installed driver source performs
element click through synchronous `scrollIntoView`, `click`, and `focus`; it does not wait for an
animation frame on that path. This does not identify the earlier timeout's cause.

Fresh snapshots drive synthetic task creation, terminal drawer opening, and the plain Shell profile.
Each bounded request completes, including the formerly failing terminal transition. The inspected
[drawer screenshot](./evidence/native-pre05-terminal.png) contains the empty session drawer. The
inspected [shell screenshot](./evidence/native-pre05-shell.png) contains a shell prompt in
`/tmp/acorn-performance-fixture`. The launcher starts no managed session. There is no controlled
before/after latency comparison and no new responsiveness claim.

The coordinator closes the owned Shell tab and stops the fixture through the documented driver.
The launcher exits zero. Recorded shell, helper, Node, and plain shell PIDs 66693, 66729, 66778 and
15200 are absent after shutdown. The final staged native and sustained-use gates remain open.

## Prepared activation fallback

`native-activate.swift` uses the installed AppKit SDK's `NSRunningApplication` activation method for
an already-running fixture PID. Before sending activation, it verifies the exact expected bundle
path, executable path, and `com.acorn.performance.automation` identifier. It does not launch an app,
scan for normal profiles, or change browser properties. Activation acceptance is asynchronous and
does not establish focus; run the bounded SDK state check afterward. The installed SDK marks
`activateIgnoringOtherApps` deprecated and ineffective from macOS 14, so this helper uses the
supported `activateAllWindows` option. Its first isolated execution is recorded below.

## Cumulative post-navigation replay

Units 01–05 pass the fresh staged desktop gate: 124 desktop and 40 Rust tests, service budget
2,811,689 bytes below its unchanged ceiling. The coordinator launches only the explicit automation
bundle as `perf-focus-after05`. [The asset record](./evidence/native-focus-after05-assets.json)
identifies these cumulative artifacts; this is not an original-build comparison.

SDK checks before and after activation report native visible true, native focused false, document
hidden and unfocused. The Swift helper runs successfully against exact app PID 19140 and verifies
the bundle path, executable and identifier, but AppKit returns activationAccepted false. Records:
`native-focus-after05-state.json`, `native-focus-after05-activation.json` and
`native-focus-after05-activated-state.json`. No browser state is overridden and no normal app is used.
These functional checks cannot establish visible latency.

`native-ui.mjs` wraps the documented renderer operations with the existing 10-second PerformanceDriver
request deadline, exact performance-bundle/session checks and fresh-reference validation. Fresh
snapshots create synthetic task `6379c91f-f2fc-4b7e-96e3-340fc18df740` in synthetic project
`dac78a4b-6499-47c4-8b98-28ab513b4d0a`. No managed provider session is started. Notes scratch creation,
body/title saving, Home navigation and task return complete. The visually inspected
[Notes screenshot](./evidence/native-after05-notes.png) displays the exact synthetic body and title.
The terminal drawer/profile menu complete; only Shell is selected. The inspected
[shell screenshot](./evidence/native-after05-shell.png) paints its prompt in
`/tmp/acorn-performance-fixture`. Home-to-task return preserves that prompt and Notes content in
[the inspected return screenshot](./evidence/native-after05-shell-return.png).

Fresh snapshots are `native-after05-*.json`; [owned process identities](./evidence/native-after05-owned-processes.json)
exclude WebKit outside the app subtree and are not before/after resource measurements. The coordinator
closes the owned Shell tab, stops through `dev:agent:ui`, and the launcher exits zero. App/helper/Node/
shell PIDs 19140, 19141, 19142 and 41097 are absent afterward. Final staging, two-Node composition,
mixed-use plateau and focused visible performance gates remain open.

## Units 01–06 API checkpoint

After staging units01–06, the coordinator launches `perf-focus-after06` through the same isolated
performance automation bundle. [The staged asset record](./evidence/native-focus-after06-assets.json)
identifies the bytes served by this checkout; it is not an original-bundle comparison.

The actual HTTP list/detail renders and accepts the synthetic unsent URL
`http://127.0.0.1:1/performance-fixture`. No request is sent. The coordinator visually inspects
[the initial API screenshot](./evidence/native-after06-api.png), the blank return screenshot, and
the final blank screenshot. Fresh snapshots after every transition preserve element references.

Return navigation remains blank when the document is hidden. A bounded fixture-only warning/error
recorder captures no errors; two `.remote-tree` containers exist with zero children. Repeating the
test-only native show/unminimize/focus verbs succeeds once: native/document focus is true and document
visibility is visible in [the focus record](./evidence/native-focus-after06-return-state.json).
The [refocused snapshot](./evidence/native-after06-return-refocused.json) and
[DOM/error record](./evidence/native-after06-diagnostics-refocused.json) show both regions rendered,
with the unsaved draft preserved. No source edit, worker patch, or browser visibility override occurs.
This observation is consistent with background WebKit worker suspension; it does not establish an
application remount defect or a general recovery timing.

A five-return attempt stops on its first blank return and does not write a success artifact. A
separate [three-cycle attempt](./evidence/native-after06-focus-cycles.json) records native/document
focus false and visibility hidden at its first cycle and fails the focus prerequisite. These runs
are excluded from sustained-navigation and visible-latency claims. Reliable focused repeated
HTTP/database/task surface checks remain part of final validation.

The fixture stop and launcher both exit zero. The identities are recorded explicitly:
[the owned-process record](./evidence/native-after06-owned-processes.json) lists launcher 82681,
app 83266, helper 83281, Node 83296, and Docker 83390. All five are absent in
[the cleanup check](./evidence/native-after06-cleanup.json). WebKit processes are not claimed as this
fixture's owned subtree, and no unrelated app is touched.

## Units 01–08 commit checkpoint

The fresh staged desktop gate passes 124 JavaScript and 40 Rust tests in the bounded repository
suite. The coordinator launches only `perf-focus-after08` against the separate performance bundle.
[Actual focus state](./evidence/native-focus-after08-state.json) reports native visible/focused true
and document visible/focused true. Synthetic task `649fa1b7-e43f-464e-9ecc-d783111639b8` uses the
non-Git `/tmp/acorn-performance-fixture` project. No managed session is started.

Fresh snapshots follow task creation, Changes, terminal drawer, profile menu, plain Shell, and Shell
removal. The coordinator visually inspects [Changes](./evidence/native-after08-changes.png) and
[the shell prompt](./evidence/native-after08-shell.png). The empty Changes state is correct for this
fixture; this does not establish native loaded-diff scrolling, composer behavior, or latency.
The first Shell-close reference expires after screenshot capture; a fresh snapshot supplies a valid
reference, and closing succeeds. The final snapshot has no terminal session.

The supported session stop and launcher exit zero. [Owned process identities](./evidence/native-after08-owned-processes.json)
contain launcher 19647, app 20260, helper 20277, Node 20387, Docker 20862, and Shell 44235.
[Cleanup](./evidence/native-after08-cleanup.json) proves all six are absent. No normal profile or
browser visibility property is changed. The fixture is stopped before the commit.

Units 09–28, reliable repeated focused navigation, two-Node composition, and sustained-use resource
plateaus remain open. This checkpoint makes no native speedup or day-long stability claim.
