# Phase 01: gate desktop commands by caller

Date: October 7, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `823db58295b84ac9f9fb52f3f85b7a6550bd8761`.
Dependency: none.

This PRD makes Acorn's own Tauri commands enforce which webview may call them, instead of relying on
an allowlist that does not cover them. Today the capability file scopes `core:default` to the main
webview and its comment states that plugin and preview webviews "get no capability at all, so `invoke`
reaches nothing from them." That is true for the built-in `core:*` commands. It is not true for
Acorn's own commands, which are authorized by a different rule.

## Problem and outcome

`apps/desktop/src-tauri/capabilities/default.json` grants `core:default` to the `main` webview only.
Acorn also registers its own commands through `generate_handler!` in `apps/desktop/src-tauri/src/lib.rs`:
`helper_endpoint`, `pick_folder`, `pick_files`, `save_file`, `open_external_url`, `reveal_data_folder`,
`open_config_file`, the `webview_*` family, the `overlay_*` family, and the rest.

In Tauri 2.11.5, a custom command is rejected by the access-control layer only when the request is a
plugin command, or the app ships an application manifest, or the origin is not local. Acorn ships no
application manifest: the Tauri build writes `gen/schemas/acl-manifests.json` under
`apps/desktop/src-tauri`, with only plugin manifest keys such as `core`, `dialog`, and `opener`.
So for any request whose origin is local, none
of Acorn's own commands is access-checked, and the `webviews: ["main"]` scope does not apply to them.

Tauri treats every registered custom scheme as a local origin. That includes `app-plugin://`, the
origin that serves third-party plugin UI through `apps/desktop/src-tauri/src/plugin_scheme.rs`. So the
scoping the comment credits is not what keeps plugin content away from these commands.

What keeps plugin content away today is a separate, implicit property: the plugin frame is a
cross-origin `app-plugin://` iframe, and the Tauri invoke key is injected into the main frame only, so
the iframe cannot assemble a valid `invoke`. That safety lives in platform behaviour of the invoke key
and subframe injection, not in the capability allowlist. The sensitive commands do no caller check of
their own. `apps/desktop/src-tauri/src/commands.rs` defines `helper_endpoint` with only
`State<Shell>`, and it returns the helper port and secret, which is the key to the device token and the
node.

The outcome: Acorn's own commands are authorized by an explicit, inspectable rule that ties them to the
main renderer, and the sensitive ones verify their caller directly. A future change that injects init
scripts into all frames, or that loads plugin-chosen content into a child webview on a local scheme,
does not become a command-execution path.

## Starting points and owners

Inspect these files and their tests:

- `apps/desktop/src-tauri/capabilities/default.json` owns what the renderer may call, and its comment
  carries the current reasoning.
- `apps/desktop/src-tauri/src/lib.rs` owns the `generate_handler!` command list, the navigation
  guards, `is_renderer_url`, and `is_plugin_url`.
- `apps/desktop/src-tauri/src/commands.rs` owns `helper_endpoint`, `pick_files`, `save_file`, and the
  other hand-written commands.
- `apps/desktop/src-tauri/src/webviews.rs` and `apps/desktop/src-tauri/src/plugin_scheme.rs` own the
  child webviews and the `app-plugin://` origin.
- The Tauri build generates `gen/schemas/acl-manifests.json` and `gen/schemas/capabilities.json`
  under `apps/desktop/src-tauri`. Inspect these access-control inputs after building the desktop.

Read the Tauri access-control model for application versus plugin manifests, and
[host-owned webviews](../../security/webviews.md).

## Required behaviour

Make the authorization of Acorn's own commands explicit, through one of two approaches. Choose the one
that holds against a Tauri upgrade and state the choice in the capability file.

- Preferred: give the app an application-level capability so its own commands require the `main`
  webview the same way `core:*` commands do. Confirm that `acl-manifests.json` then carries an
  application manifest key, so the access-control layer checks these commands on every origin rather
  than skipping local ones.
- If the application-manifest route is not viable on the pinned Tauri, add a caller check inside each
  sensitive command. Reject a call whose webview label is not the main renderer. Treat
  `helper_endpoint`, `save_file`, `pick_files`, `pick_folder`, and the `webview_*` family as sensitive
  at minimum; review the full list and record which commands are safe to leave open and why.

Preserve every call the main renderer makes today. The bridge reaches these commands from the main
webview, and that path must keep working unchanged. Preview and plugin webviews must reach none of
them.

Correct the comment in `default.json`. State that the capability scopes `core:*` commands, that
Acorn's own commands are authorized by the chosen mechanism, and that the plugin frame's cross-origin
isolation is defence in depth rather than the primary guard. The comment is load-bearing: a future
reader trusts it.

## Contracts and data flow

The invoke path is renderer to Tauri to a Rust command. The decision point is the access-control
resolution for a command, keyed by command name, webview label, and origin. Keep the main renderer's
label stable so a label check has a fixed target. Do not loosen the navigation guards in `lib.rs` or
the scheme handlers; this phase narrows command reach, it does not change what the webviews load.

If the sensitive-command check reads the calling webview, take the label from the command's own
context rather than a value the caller sends. A command must not trust a caller-supplied identifier
for its own authorization.

## Acceptance and verification

Exercise these flows in a real desktop build:

- The main renderer calls `helper_endpoint`, `save_file`, `pick_files`, and a `webview_*` command and
  each works as it does today.
- A page loaded in the `app-plugin://` origin cannot invoke any of Acorn's own commands. Confirm the
  rejection comes from the chosen mechanism, not only from the missing invoke key.
- A preview webview, which loads remote `https://` content, cannot invoke any of Acorn's own commands.
- `acl-manifests.json` reflects the chosen approach: an application manifest key is present if that
  route was taken.

Run `pnpm --filter @acorn/desktop test` for the Rust and desktop suites, and `pnpm lint`. Use the
[desktop driver](../../local-development/agent-drivers.md) to drive the main renderer path. The driver
cannot reach child webviews, so verify the plugin-origin and preview-origin refusals through a Rust
test over the access-control resolution or a logged rejection, and record what could not be automated.

Update [host-owned webviews](../../security/webviews.md) and [the security model](../../security.md) to
describe how Acorn's own commands are authorized, so the shipped docs match the mechanism.

## Verify before building

- Confirm on the pinned Tauri version whether an application-level capability produces an application
  manifest key, and whether that makes the access-control layer check local-origin calls.
- Confirm the main renderer's webview label and that it is stable across launches.
- Read every command in the `generate_handler!` list and classify each as sensitive or safe to leave
  open, with a reason, before adding checks.
- Confirm that no legitimate main-renderer call depends on a local-origin bypass that the fix removes.
