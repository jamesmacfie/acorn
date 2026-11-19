# Phase 2: let the desktop renderer use the microphone

Date: November 19, 2026. Status: proposed. Depends on nothing.

## Goal

`navigator.mediaDevices.getUserMedia({ audio: true })` works in the desktop app's own renderer. macOS
asks once with an Acorn-specific reason. Plugin frames still can't reach the mic.

## Changes

1. Add `com.apple.security.device.audio-input` to `apps/desktop/src-tauri/entitlements.plist`. The
   bundle is signed with the hardened runtime, which blocks the mic without it. Add a line to the
   comment at the top saying why.
2. Add an `NSMicrophoneUsageDescription` string. Suggested text: "Acorn uses the microphone only while
   you dictate a message to an agent." Put it in an `Info.plist` in `apps/desktop/src-tauri/`, which
   the Tauri bundler merges.
3. Grant media capture for the renderer's own origin and nothing else. The grant goes in the web
   view's permission handler (the `WKUIDelegate` media capture callback on macOS). Deny every
   `app-plugin://` origin explicitly, even though plugin frames have no `allow="microphone"`.
4. Leave `PluginFrame.tsx` without an `allow` attribute. Add a test that fails if one appears.

## Verify before building

- Whether wry, through Tauri 2, already answers the macOS media capture callback, and how. If it
  grants every origin, step 3 must narrow it. If it denies, step 3 must add the grant.
- Whether the Tauri bundler picks up `src-tauri/Info.plist` automatically or needs `bundle.macOS`
  config in `tauri.conf.json`.
- Which process macOS charges the mic to in `pnpm dev`, where the app isn't a signed bundle. The
  prompt may name the terminal app instead of Acorn.
- What Linux (WebKitGTK's permission request signal) and Windows (WebView2's `PermissionRequested`)
  do by default. Record the answer, even if those platforms wait.

## Done when

- In a packaged build, a `getUserMedia` call from the renderer shows the macOS prompt with the new
  reason once, then returns a live audio track.
- The same call from a plugin frame fails with `NotAllowedError`.
- `cargo test` covers the origin check, and the client-core test covers the missing `allow`
  attribute.

## Owning pages

Update [the shell](../../shell.md) and [origins](../../shell/origins.md) with who may use the mic.

## Checkpoint

Not run.
