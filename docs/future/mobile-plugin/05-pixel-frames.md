# Phase 5: plugins that paint their own iframe

Date: October 23, 2026. Status: proposed. Depends on [phase 3](./03-browser-custody.md).

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

None yet.

## Verify before building

Recheck which plugins use a `frame` region, and check that phase 2's sandbox host can serve a second
document.
