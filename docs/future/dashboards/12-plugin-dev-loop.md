# Phase 12: developing a derived source against real data

Status: proposed, October 5, 2026. Depends on [phase 8](./08-source-inputs.md) and
[phase 11](./11-derived-source-sdk.md), and on [phase 3](./03-studio-shell.md) for the studio
strip. Read the [programme README](./README.md) first. The
[Derived Sources](https://claude.ai/artifact/W8vHKDojobsSD4GYi5xPxK) page shows the development strip
in "Running it against real data".

## Goal

An author installs their plugin from a folder, turns on development mode from the plugin's page,
and builds a panel on it. Each save reloads the plugin. The studio shows what the source read, how
long it took, and which records didn't match the declared fields, with a link to the logs.

## Starting point

- **Settings › Plugins › Install… › Local folder** links a folder to the Node. "acorn links to this
  folder instead of copying it."
- Development mode trusts new client bundles without asking. The plugin page offers **Turn on** only
  for device plugins. A node plugin's development mode comes only from an agent's
  `plugin_request` with `dev: true`.
- `POST /v1/core/plugins/:id/reload` hot-swaps the node half (`packages/node-core/src/server/plugins/reload.ts`).
  Nothing in the app calls it for a folder plugin.
- `ctx.log` writes stderr lines prefixed with the plugin id, and telemetry records when telemetry is
  on (`docs/plugin-authoring/telemetry.md`). The app has no view of them.
- Load failures show on the roster row with `state: 'failed'`, a `reason`, and a `stage`.
- After phase 8, a derived source drops records that fail validation and reports the count.

## Requirements

### Development mode for node plugins

1. Offer **Turn on** under **Development mode** on the plugin page for node plugins installed from a
   local folder. It's off for every other source, because a downloaded version should always be
   reviewed.
2. In development mode, the Node watches the folder's built files, debounces changes by 500 ms, and
   calls the existing reload path. A failed reload keeps the previous version running and shows the
   failure on the roster row, as a failed load does.
3. Development mode also auto-grants the plugin's declared inputs (phase 8), so an author changing
   inputs isn't asked on every save. The grant is marked as a development grant and removed when
   development mode is turned off, which brings back the normal approval (phase 9).
4. The plugin row's status reads "In development. Reloads when its files change." Add it to
   `packages/client-core/src/host/plugins/pluginStatus.ts`.

### Logs

5. Keep the last 500 log lines per plugin in memory on the Node while development mode is on. Add
   `GET /v1/core/plugins/:id/logs` to read them, and a **Logs** section on the plugin page that shows
   them newest last, with level and time. Nothing is kept on disk and nothing is kept when
   development mode is off.

### Source diagnostics

6. While a derived source's plugin is in development mode, the run adds per-source diagnostics: each
   input's record count and read time, the plugin's own time, and up to 20 dropped records, each
   with its id, the field pointer, and the validation message.
7. In the studio, a source in development shows a strip under the toolbar: the plugin id, "reloaded
   *relative time*", what each input read and how long the run took, and "*N* records didn't match
   the declared fields" in a warning tone when there are any. Buttons: **Show records**, **Reload
   plugin**, and **Logs**, which opens the plugin page's **Logs** section.
8. **Show records** replaces the preview with a table of the dropped records: record, field, and
   problem, such as `"needs-qa" isn't a declared choice`.
9. The toolbar shows a **Source in development** badge, and **Publish…** warns "This panel reads a
   source in development. Others will see it change as you edit the plugin." without blocking.

## Out of scope

- A terminal command for the dev loop. The app's plugin page is the one place to turn it on.
- Stepping through plugin code. Authors use the test helpers from phase 11 for that.

## Tests

- Node tests: development mode only for folder installs, the debounced reload, a failed reload
  keeping the old version, the development grant added and removed, and the log ring buffer.
- Run tests: development diagnostics appear only in development mode and cap dropped records at 20.
- `PanelStudio.test.tsx`: the strip, **Show records**, and the **Publish…** warning.

## Check it in the app

Scaffold a package with `npm create acorn-plugin -- --data-source`, install the folder in a
`dev:agent` session, and turn on development mode. Build a panel on its source. Change a choice id
in the code so some records stop matching, save, and check that the strip reports them within a
few seconds and **Show records** names the field.

## Docs to update

- `docs/plugins/dev-loop.md`: development mode for folder-installed node plugins.
- `docs/plugin-authoring/installing-a-hand-written-package.md`: turning on development mode.
- `docs/plugin-authoring/telemetry.md`: the in-app log view and when it keeps lines.
- `docs/api-reference/core-routes.md`: the logs route.

## Verify before building

- How the Node watches files elsewhere, if anywhere, so the folder watch reuses it.
- That `reload.ts` can be called repeatedly in quick succession without leaking workers.
- That keeping log lines in memory doesn't change the telemetry path when telemetry is on.
