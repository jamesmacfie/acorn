# WebDriver window lookup patch

Source: `tauri-plugin-wdio-webdriver` 1.4.0, published by
[WebdriverIO](https://github.com/webdriverio/desktop-mobile). The MIT license is in `LICENSE`.

Acorn adds native page children to the main Tauri window. Tauri then stops reporting that window
through `webview_windows()`, although its renderer and window remain live. The upstream driver uses
that projection for every renderer request and returns “No window could be found.”

The patch retains the original renderer handle after its first lookup, reconciles newly created
windows, and removes closed windows. The server also checks the request's Host and Origin before
dispatch against the loopback address and selected port used by Acorn's agent launcher. Behavior
changes are in `src/server/mod.rs`, `src/server/caller.rs`, and `src/server/handlers/window.rs`.
Three trailing spaces in `src/platform/linux.rs` are removed. This package is compiled only by
Acorn's `agent-automation` feature, which the shell refuses in release builds.

Remove this vendored copy when the upstream driver supports windows containing child webviews.
