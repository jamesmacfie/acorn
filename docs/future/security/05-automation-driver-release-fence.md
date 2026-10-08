# Phase 05: fence the automation driver out of releases

## Completion note: October 9, 2026

Status: implemented. The release fence was already in
`apps/desktop/src-tauri/src/lib.rs`: a build with `agent-automation` and release assertions disabled
fails at `compile_error!`. The release workflow calls `pnpm --filter @acorn/desktop run dist
--prebuilt`, whose Tauri build uses the default Cargo features. The default dependency graph excludes
`tauri-plugin-wdio-webdriver`; enabling `agent-automation` includes it. No second feature gate was
added. The shell uses the same `debug_assertions` distinction for its packaged behavior.

The vendored server applies one middleware layer before all WebDriver routes. It requires exactly one
`Host` of `127.0.0.1:<selected port>` and, when present, exactly one `Origin` of
`http://127.0.0.1:<selected port>`. Missing, malformed, duplicated, foreign, and wrong-port headers
are refused with 403. The Node driver uses `fetch` without `Origin` against that exact endpoint.
Desktop binding remains loopback. The vendored crate declares Tauri's `unstable` feature because its
existing window lookup uses that API; the desktop already activated it. A direct `tower` test
dependency exercises the middleware without a Tauri window.

Verification:

- `cargo tree --manifest-path apps/desktop/src-tauri/Cargo.toml -e normal -i
  tauri-plugin-wdio-webdriver` found no package without the feature. With `--features
  agent-automation`, it resolved the vendored package under `acorn-desktop`.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --release --lib` passed after
  staging. The same command with `--features agent-automation` failed at the existing
  `compile_error!` in `src/lib.rs:23`. This checks the release profile and resolved feature set used
  by the real Tauri build path. A signed or bundled installer was not built.
- The vendored test `only_the_chosen_loopback_endpoint_reaches_a_handler` passed. It covers admission,
  foreign hosts and origins, wrong ports, duplicate headers, and malformed Origin bytes. The test ran
  from the vendored manifest with a temporary copy of the desktop lockfile and a shared target
  directory; both temporary files were removed.
- The real debug driver built with `--features agent-automation`, launched an isolated macOS window,
  read `app://acorn` through `pnpm dev:agent:ui ... snapshot`, clicked Agents, and read the Agent
  Center afterward. Live requests to `/status` returned 200 with the driver's headers and a matching
  Origin, and 403 for a foreign Origin, foreign Host, or wrong Host port. The session was stopped.
- `pnpm --filter @acorn/desktop lint`, `pnpm --filter @acorn/arch-tests exec vitest run
  --maxWorkers=1` (87 tests), focused doc checks (six tests), `rustfmt --check` on the new module,
  and `git diff --check` passed. No full repository test or lint run was made.

The ordinary stage command stopped at an unrelated Node service graph budget:
`3180280/3177000B`. Its output and every other stage input built, so the acceptance run used a
temporary copy of the launcher with only its repeated `stage` call omitted. Its renderer build,
debug Cargo build, session seeding, WebDriver calls, and shutdown were unchanged. The first launcher
attempt hit the sandbox's `tsx` IPC socket denial; the authorized socket run passed. The unchanged
renderer budget is also known to exceed its ceiling, so a complete installer build remains outside
this phase's evidence. Neither budget was raised or changed.

Android is not in the macOS and Windows desktop release matrix. The existing vendored Android debug
server binds all interfaces for WiFi access; this policy would reject requests addressed to that
non-loopback endpoint. The release compile fence applies to Android too, but mobile driver support
needs its own caller policy if that debug workflow becomes part of Acorn's supported paths. Host and
Origin checks protect against browser cross-origin and DNS rebinding requests, not another local
process able to forge HTTP headers.

Date: October 7, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `823db58295b84ac9f9fb52f3f85b7a6550bd8761`.
Dependency: none.

This PRD keeps the vendored WebDriver automation server out of shipped builds by a check rather than a
convention, and adds a caller check so the server refuses cross-origin requests if it ever runs. The
automation driver drives the whole app over a local port, so a build that ships it with the feature on
is a remote-control surface.

## Problem and outcome

`apps/desktop/src-tauri/vendor/tauri-plugin-wdio-webdriver` is a vendored Tauri plugin that binds a
control port and drives the app. It is gated behind the `agent-automation` Cargo feature in
`apps/desktop/src-tauri/Cargo.toml`, and `apps/desktop/src-tauri/src/lib.rs` registers it only under
that feature. The agent flow scripts are the only callers, and a normal build leaves the feature off.
That is the right arrangement.

Two things keep it a convention rather than a guarantee:

- The gating is build-time only. Nothing fails a release build that turns the feature on, so a mistake
  in the release configuration ships the automation server silently.
- The server does no `Host` or `Origin` check. It binds loopback on desktop platforms, but a local web
  page could drive it through a DNS-rebinding style request to the loopback port if the feature were
  ever present in a build a user runs.

The outcome: a release artifact cannot carry the automation feature, proven by a check in the build or
test gate rather than trusted to configuration. And if the server runs, it refuses a request whose
origin or host is not the automation client, so a stray local page cannot drive it.

## Starting points and owners

Inspect these files and their tests:

- `apps/desktop/src-tauri/Cargo.toml` declares the `agent-automation` feature and the optional
  dependency.
- `apps/desktop/src-tauri/src/lib.rs` registers the plugin under the feature.
- `apps/desktop/src-tauri/vendor/tauri-plugin-wdio-webdriver/src/server/mod.rs` binds the port and
  serves the router.
- `apps/desktop/scripts/agent/flow.mjs` and `apps/desktop/scripts/agent/session.mjs` build with the
  feature for the agent drivers.
- The release and continuous-integration workflow under `.github/` that builds installers.

Read [the dated review](../../security/review-2026-10-01.md), which records the continuous-integration
and release posture, and [the desktop drivers](../../local-development/agent-drivers.md).

## Required behaviour

Add a gate check that fails if a release artifact carries the automation feature. Prefer a check in the
release build or the test gate that inspects the compiled artifact or the resolved feature set, so a
release with `agent-automation` on cannot pass. State where the check lives and what it inspects.

Add a caller check to the automation server so it refuses a request that does not come from the
automation client. Reject a request whose `Origin` or `Host` is not the expected local automation
endpoint, so a page in a browser cannot reach the loopback port through a rebinding. Keep the agent
drivers working: the check must admit the client the flow scripts use.

Preserve the developer workflow. A build with the feature on, started by the agent scripts, still runs
the automation server and the drivers still control the app. The release fence and the origin check
constrain an unintended build and an unintended caller, not the intended development loop.

## Contracts and data flow

The feature flows from the Cargo feature set into the compiled binary. The release fence reads that set
or the artifact and fails closed. The automation server's caller check reads the request's origin or
host at the point it accepts a request, before it dispatches to a handler that drives the app. Do not
loosen the loopback bind; the origin check is in addition to it, not a replacement.

## Acceptance and verification

Exercise these cases:

- A release build with the automation feature left off passes the gate. A release build with the
  feature on fails the gate check.
- The agent drivers, built with the feature on, still drive the app end to end.
- A request to the automation port with an unexpected `Origin` or `Host` is refused; the automation
  client's own requests are admitted.

Run `pnpm --filter @acorn/desktop test`, the agent driver flow, and `pnpm lint`. Add a regression for
the origin or host refusal in the vendored plugin's tests. Record any platform where the gate check
cannot inspect the artifact and what covers it instead.

Note the release fence and the origin check in [the security model](../../security.md) or the webviews
page, so the shipped docs record why the automation surface cannot reach a user's build.

## Verify before building

- Confirm how the release workflow selects features, so the gate check inspects the real release path.
- Confirm the automation client's origin and host, so the caller check admits it and nothing else.
- Confirm the Android bind path in the vendored server, which binds all interfaces, is out of scope for
  the desktop release or is covered by the same origin check.
- Confirm the agent flow scripts still pass with the origin check in place before relying on them.
