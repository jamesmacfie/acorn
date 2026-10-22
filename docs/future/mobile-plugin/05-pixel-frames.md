# Phase 5: plugins that paint their own iframe

Date: October 23, 2026. Status: built on the open side. Real-device checkpoint skipped. Depends on [phase 3](./03-browser-custody.md).

## Completion note

October 23, 2026, on branch `phase-5-pixel-frames`.

What landed:

- The frame page on the sandbox host: `apps/mobile/sandbox/frame.html`, `frame-host.js`, and `bundle-check.js`, the base32 check it
  now shares with the relay page. `build-sandbox.mjs` also writes `ui.css` into `dist-sandbox`.
- `FRAME_STYLES` moved out of the desktop's `stage.mjs` into `packages/client-core/src/infra/styles/frameStyles.mts`, with
  `readFrameStyles()`. The desktop's staging, the phone's sandbox build, and `cssHygiene.test.ts` read the one list.
- `host/tree/sandboxOrigin.ts` holds what the tree relay and frames share: the bundle source (renamed `setBundleSource`, because it
  isn't only for trees), `phoneSandboxOrigin`, and `pluginFrameOrigin`, the one origin function. `PluginFrame` uses it.
- `host/frames/phoneFrame.ts` is the phone's start: wait for the page's ready, post the bytes, wait for loaded, then the usual bridge.
  A refusal, a missing source, or a 10-second silence shows "This plugin's UI failed to start".
- The overlay host: the phone's shell mounts `SlotHost slot="overlay"`. On a narrow device `SlotHost` draws only a shell slot
  contribution marked `onPhone`, and register.ts marks a plugin's overlay frame. `overlays.css` makes `.plugin-overlay` fill the
  sheet. The existing narrow rule already made it full-screen.
- A tree that asks for a companion overlay the device doesn't register (the manifest's `formFactor` leaves out `mobile`) now gets
  `unsupported_host`. Before, it would have waited forever.
- Docs: [frames](../../plugins/frames.md), [the plugin frame origin](../../shell/origins.md#the-phones-plugin-frame),
  [the phone's plugin sandbox](../../mobile/plugin-sandbox.md#frames), [serve the sandbox domain](../../mobile/phone-setup.md#serve-the-sandbox-domain),
  and short pointers in the mobile, narrow-mode, registries, and remote-points pages.

Decisions and deviations:

- **Two-step start.** The design had the page import the bytes when it receives them. A frame's `connect()` listens when its module runs,
  and the port must not arrive earlier, so the page says `acorn:frame-loaded` after the import and the host transfers the port then.
  That is the desktop's `load` event, with the same 10-second hello deadline after it.
- **Headers by path.** The frame page needs `blob:` in `script-src` and style, image, and font sources, which the relay's policy must
  not have. `headers.json` is now `{ "/*": relay set, "/frame.html": frame set }`, with no merging. Nothing hosted reads it yet, so
  the shape change breaks no one. The hosted step must serve it that way.
- **One shared check, one global.** `bundle-check.js` sets `globalThis.checkedBundleUrl`, because oxlint flags a top-level function
  that only other scripts call. The tests concatenate the two scripts, as the browser shares one scope.
- **`pnpm dev:mobile` serves the built `dist-sandbox`**, with `headers.json`'s per-path rules, instead of its own file map.
- **An export.** `@acorn/client-core` publishes `frameStyles.mts`, because a relative import across packages fails the architecture
  suite. The limit went from 214 to 215.
- **Image markup isn't in this repository.** Checkpoints used a throwaway stand-in plugin, since deleted: a task pane frame, an overlay
  frame, and an `agents:attachment` tree whose button opens the overlay. Its Node half read and replaced the draft through
  `agents.draftAttachments`. The stand-in's recipe is in the evidence.
- **The public site's pages** that cite frames teach nothing about form factors, so I left them unmarked.

What later phases need to know:

- A frame's bundle comes from the same source as a tree's. Anything that changes custody's reads changes both.
- The WebKit console shows "Refused to apply a stylesheet" from the tree relay page, `worker.html`. It isn't new to this phase (the page
  gained a script tag and nothing else), I didn't trace it, and Chromium shows nothing.
- First screen after this phase: 512,047 B of scripts against 520,000 B, and 127,076 B of styles against 128,000 B.
  The slot host and its context added 849 B of scripts and 59 B of styles.

### Open questions

- Does a tap give an iframe focus on iOS? Tapping inside the frame made the iframe the shell's active element in Playwright WebKit and Chromium
  on a desktop. iOS Safari needs the owner's phone, so it stays open with checkpoint 5.
- Is `img-src data:` enough? Yes. `/ui.css` has no `url()` that isn't a `data:` URI, and the policy also allows the page's own origin.


## Design

- **Document.** `https://<label>.<sandbox domain>/frame.html#<nonce>`, with `/frame-host.js`, `/bundle-check.js`, and `/ui.css` beside it.
  Its policy is the desktop frame's with `script-src 'self' blob:`. Every other path keeps the relay policy.
- **Messages**, all carrying the nonce: the page posts `acorn:frame-ready`. The host answers `acorn:frame-bundle` with the bytes. The page checks them
  against its label, imports them from a `blob:` URL, and posts `acorn:frame-loaded`, or `acorn:frame-error`. Then the host transfers the bridge port.
- **Origin.** `pluginFrameOrigin` in `host/tree/sandboxOrigin.ts`.
- **Overlay host.** The shell's existing `overlay` slot, mounted in the phone's `Frame` component in `Shell.tsx`, showing only contributions marked `onPhone`.
  A plugin's overlay frame draws as the narrow dialog sheet.

## Goal

A plugin that paints its own iframe draws on the phone, from its own origin and with no network, as
it does on the desktop.

## What works at the end

A task pane or an overlay whose region is `frame` draws on the phone. Image markup opens from an
agent attachment, and its edit saves.

## Starting point

- `packages/client-core/src/host/frames/PluginFrame.tsx` embeds `app-plugin://<hash>/` with
  `sandbox="allow-scripts allow-same-origin"`, transfers one `MessagePort`, and starts a 10-second
  deadline for the frame's hello ([frames](../../plugins/frames.md)).
- On the desktop, `apps/desktop/src-tauri/src/plugin_scheme.rs` generates the frame's document, which
  loads `/ui.css` and `/client.js`, under `connect-src 'none'; frame-src 'none'; worker-src 'none'`.
  `apps/desktop/scripts/stage.mjs` builds `/ui.css` from client-core modules.
- Of the plugins checked, image markup, an overlay opened from an agent attachment, and machine-stats,
  a project pane, paint their own iframe. The phone has no overlay host and no project screen.

## The design to confirm

- **A frame document on the sandbox domain.** Phase 2's host serves a frame document whose host-owned
  bootstrap receives the bytes, checks them against its label, and imports them from a `blob:` URL.
  Its policy is the desktop frame's, with `script-src 'self' blob:`.
- **The same stylesheet.** The phone build writes `/ui.css` into the sandbox folder from the module
  list `stage.mjs` uses, so a frame looks the same on both.
- **One origin function.** `PluginFrame` takes its origin from one function that knows the desktop's
  scheme and the phone's sandbox domain, as `pluginTreeRelayOrigin` does for trees.
- **An overlay host on the phone.** A full-screen sheet, which is what a `Drawer` is on a phone
  ([narrow layouts](../../mobile/narrow-mode.md#narrow-layouts)).

## In scope

- The frame document, its bootstrap, and `/ui.css` on the sandbox host.
- The origin function in client-core.
- An overlay host in the phone's shell.

## Out of scope

Project-scoped panes, so machine-stats stays on the desktop. Reference panels.

## Steps and checkpoints

### 1. Write the design

Name the frame document's path, the bootstrap's messages, and the overlay host's place in the shell.

### 2. The frame document

**Checkpoint 1: a fixture frame draws.** In Playwright WebKit at 390 by 844, a fixture task pane with
a `frame` region draws and answers its hello in time.

**Checkpoint 2: no network.** The fixture frame calls `fetch` and loads an image from another origin.
Both should fail, and a probe server should see nothing.

**Checkpoint 3: tampered bytes.** Post bytes that don't match the label. The frame shouldn't start, and
the pane should show "This plugin's UI failed to start".

### 3. The overlay host

**Checkpoint 4: image markup.** Attach an image to an agent message on the phone, open image markup,
draw on it, and save. The edit should reach the attachment.

### 4. Real phones

**Checkpoint 5: iOS and Android.** On both phones, repeat checkpoints 1 and 4.

## Acceptance

- A frame task pane and image markup draw on both phones.
- A frame has no network, and tampered bytes don't run.
- The desktop's frames behave as before.

## Docs to update when it ships

- [Frames](../../plugins/frames.md): frames on the phone.
- [The plugin frame origin](../../shell/origins.md#the-plugin-frame-origin): the phone's frame
  document.

## Open questions

- Does a tap give an iframe focus on iOS? `openUrl` and claimed keys need the frame to hold focus.
- Is `img-src data:` enough for a frame's icons when its stylesheet comes from the sandbox host?

## Evidence

October 23, 2026. Playwright WebKit 2370 and Chromium 1234 at 390 by 844, on one machine: `pnpm dev:account`, `pnpm dev:mobile` (sandbox on
`localhost:4322`), a standalone Node with the stand-in plugin (built with `build-plugin.mjs --package-root`, then `requires.plugins` added to its
manifest by hand, because the builder doesn't forward it), and a probe server on `127.0.0.1:48999` that logs every request.

- **Checkpoint 1, passed.** The task pane drew from `http://<label>.localhost:4322` and its first line appeared in 1,060 ms in WebKit and 568 ms
  in Chromium, well inside the 10-second deadline. A button with `ui-btn` took the host's `/ui.css`.
- **Checkpoint 2, passed.** `fetch` and an image from `127.0.0.1:48999` both failed, and the console named `connect-src 'none'` and
  `img-src 'self' data:`. The probe server logged nothing from either engine. A `curl` to it afterward logged one request, so it was listening.
- **Checkpoint 3, passed.** With one byte appended to the stored bundle in the phone's IndexedDB, opening the pane showed "This plugin's UI failed to
  start" in both engines, with no iframe left behind.
- **Checkpoint 4, passed with a stand-in.** A session was seeded into the Node's agents database. On the phone I attached a PNG in the composer, and the
  plugin's tree drew its button in place of the chip. The button opened the overlay as a 390 by 844 sheet, a stroke drawn on the canvas saved through
  the plugin's route, the overlay closed, and the composer's draft held the new attachment, with the original marked deleted. The stored image
  showed the red stroke. Both engines did this. Not covered: the stand-in isn't image markup, and nobody held a finger on a real screen.
- **Desktop, unchanged.** In `pnpm dev:agent` a stand-in pane frame drew on `app-plugin://<hash>` with the same stylesheet, and its `fetch` and image
  were blocked. The Rust handler didn't change.
- **Checkpoint 5, skipped.** It needs the owner on an iPhone and an Android phone.
- **Hosted service, skipped.** The wildcard host must serve `headers.json` by path and the new files. No hosted repository here.
- **Gates.** `pnpm lint` passes. Tests pass for client-core (3,000), mobile, the architecture suite (98), the desktop's two golden suites, and the
  site's `keybindings.test.mjs`. The site's own full test needs a browser run I didn't do.

## Verify before building

Recheck which plugins use a `frame` region, and check that phase 2's sandbox host can serve a second
document.
