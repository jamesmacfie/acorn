# Rail artwork in the desktop, October 19, 2026

This page records one check of rail presentation and `Artwork` in a real desktop window. It's the
evidence for [rail presentation and artwork](../plugins/rail-presentation.md). The check ran on the
`artwork` branch, before commit, on top of `94c846590`.

## How to rerun

1. Run `pnpm dev:agent -- --session artwork`. When the bundled plugins finish building, copy
   `examples/plugins/acme-tracker` into `apps/desktop/dist/bundled-plugins/` before the Node boots.
   A development build installs and trusts every package in that folder.
2. When the launcher prints `ready`, take a `pnpm dev:agent:ui -- --session artwork snapshot`. If the
   session's saved `rail_visibility` preference hides `acme-tracker:issues`, turn it back on in
   **Settings > Plugins > Rail and surfaces**.
3. With Home open, read the `.tabrail-source[data-source-id=issues]` button with `run`, hover it,
   then click it.
4. Stop the session and delete `apps/desktop/dist/bundled-plugins/acme-tracker`.

## What it showed

With Home open, the **Acme issues** button drew the example's picture in a 20 by 20 pixel square
inside its 47 by 48 button. The picture came from a `blob:` URL, so the bytes went through the broker
and never reached the image element as a Node address. The `core:source` status dot stayed at the
button's corner, outside the picture.

The button kept `Acme issues` as its accessible name and its tooltip title. The tooltip read, in
order: `Acme issues`, `ACME-12 in progress`, `Webhooks give up after one retry`, `2 open`, then the
existing status legend line, `2 open issues — acme-tracker`. The button's description held the same
words. Clicking the button opened the source's list and detail and set `aria-current="page"` on it.
The square and picture drew the same way after switching to the dark theme.

## Not checked here

The stale notice after a Node disconnect, a cover change pushed on the plugin's channel, the other
style packs, and the terminal client were not checked in a real window. Unit and host tests cover
them: `packages/client-core/src/host/chrome/railPresentation.test.tsx`,
`packages/client-core/src/features/tabs/TabRail.test.tsx`, and `apps/tui/src/chrome/chrome.test.tsx`.
