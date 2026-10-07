# Phase 05: fence the automation driver out of releases

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
