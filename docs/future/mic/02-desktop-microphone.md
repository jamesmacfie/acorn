# Phase 2: let the desktop renderer use the microphone

Date: November 19, 2026. Status: built, packaged-build check not run.

What landed is described in [origins](../../shell/origins.md#microphone): the audio-input
entitlement, `NSMicrophoneUsageDescription` in `apps/desktop/src-tauri/Info.plist`, the shell's
`media_permission` handler, and the test that keeps `allow` off plugin frames.

## Answers found while building

- Wry 0.57 grants every media request from any page when no handler is set, and its handler gets no
  origin. So the handler goes by webview: the main window's renderer gets the mic, every other
  webview, child browser webviews included, is refused, and nothing gets the camera. A plugin frame is
  kept out by the missing `allow="microphone"`.
- Tauri's codegen embeds `src-tauri/Info.plist` into a dev build. The bundler merging it into a
  packaged one is assumed, not checked.
- Linux and Windows raise the request through the same handler in wry. Not tried on either.
- macOS charges the mic to the process that launched the app, not to the app. A `dev:agent` window
  started from an agent inside the installed Acorn asks as `/Applications/acorn.app`, and a build
  without the audio-input entitlement is refused with no prompt. Start a test session from your own
  terminal app, and macOS asks as that terminal. Found November 19, 2026.
- WebKit hides `navigator.mediaDevices` from an app with no `NSMicrophoneUsageDescription`, so the
  `dev:agent` bundle (`apps/desktop/scripts/agent/nativeApp.mjs`) carries the string too.

## What's left

- In a packaged build, call `getUserMedia` from the renderer: macOS should ask once with the new
  reason and then return a live track. The same call from a plugin frame should fail with
  `NotAllowedError`.

## Checkpoint

Not run.
