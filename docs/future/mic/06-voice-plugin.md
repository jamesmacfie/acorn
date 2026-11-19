# Phase 6: the voice plugin

Date: November 19, 2026. Status: proposed. Depends on phases 1, 3, and 4.

## Goal

A loaded plugin, ID `voice`, in its own repository at `../acorn-voice`. It turns audio into text on
the Node with the engine and model phase 1 chose. It asks before it downloads anything.

## The manifest

- `permissions.node.dataFolder: true` for models and engine binaries (phase 3).
- `permissions.node.exec: true` to start the engine process.
- `permissions.node.net` with the exact hosts for the model and binary downloads. Hugging Face
  redirects `resolve` URLs to a separate file host. A host-scoped grant returns the redirect instead
  of following it, so the plugin follows the `Location` itself, and the grant lists both hosts.
- `contributions.speechEngines` with one engine (phase 4).
- A `settings` surface, a tree, for consent, models, and the dictionary.
- `contributions.auditActions` for `model.download` and `model.delete`. Those are worth a line in the
  owner's trail. Transcriptions aren't.

## The settings page

- Each model as a row: name, languages, size, and whether it's downloaded. **Download** shows the
  size again and asks once. A download shows progress and can be cancelled.
- One model is active. Picking another unloads the first.
- **Delete** removes a model's files.
- A language choice: one language or automatic, for multilingual models.
- The dictionary: a table of what the model writes and what you want instead. Apply replacements
  after transcription, whole words only, case-insensitive.

## The engine process

- Download the engine binary for the Node's platform and architecture into the data folder, check
  its SHA-256 against a value pinned in the plugin, then mark it executable.
- Start it on demand, keep it running while the plugin is enabled, and stop it in `dispose`. Talk to
  it over a loopback port the plugin picks, or over stdin and stdout if the engine allows. A port
  needs `127.0.0.1` in `net`.
- Preload the model when the settings page or the composer asks for `status`, so the first dictation
  doesn't pay the load.
- If the process dies, restart it once. If it dies again, answer `failed` with the reason.
- Write the WAV to a temporary file in the data folder only if the engine needs a file, and delete it
  as soon as the call returns.

## Routes

- `POST /transcribe` and `GET /status`, as phase 4 defines.
- The settings tree's own reads and writes: models, downloads, the active model, the dictionary.
- `ctx.runs.register` for downloads, so they show in the Node's list of running work.
- `ctx.events.send` on `plugin:voice:status`, so the settings page and the composer update without
  polling.

## Verify before building

- The binary and model URLs, sizes, checksums, and licences, for macOS arm64 and Linux x64 at least.
- Whether macOS runs a downloaded, unsigned engine binary started by the bundled Node. Phase 1 should
  have answered this.
- How long the model takes to load cold, and whether that needs a **Preparing** state in the
  composer.

## Done when

- On James's Mac: install the plugin, agree to download Parakeet v2, dictate into a session, and the
  text lands in the draft.
- Release-to-text is within 100 ms of phase 1's measurement for the same engine.
- After a Node restart, the first dictation works without visiting Settings.
- Disabling the plugin stops the engine process. Uninstalling it removes the data folder.
- No transcript text appears in the Node log, telemetry, or the audit trail.
- The phone, paired to the same Node, can dictate. Record the latency through the relay.

## Checkpoint

Not run.
