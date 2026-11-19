# Phase 6: the voice plugin

Date: November 19, 2026. Status: built in `~/Source/acorn-voice`, and checked in `pnpm dev:agent` without the mic.

Its README describes what it does, its permissions, and its data folder.

## Where it differs from the plan

- The engine is sherpa-onnx's Node addon, run by a small Node helper process the plugin starts, not
  a prebuilt sherpa-onnx server. The addon comes from npm as one package per platform, checked
  against npm's published integrity hash.
- The helper inherits the worker's permission flags, which Node passes to every child process. It
  adds `--allow-addons` to load the native addon.
- One model, so there's no picking between models and no language choice yet.
- The settings and the dictionary live in `settings.json` in the data folder, not in a database.

## What's left

- Download the model for real through the settings page, then dictate in the installed app.
- Release-to-text within 100 ms of phase 1's figure, through the whole path.
- After a Node restart, the first dictation works without visiting Settings.
- Disabling the plugin stops the engine. Uninstalling it removes the data folder.
- No transcript text in the Node log, telemetry, or the audit trail.
- The phone, paired to the same Node, can dictate. Record the latency through the relay.

## Checkpoint

Partly run in `pnpm dev:agent`, November 19, 2026, with the engine and model copied from the phase 1
spike rather than downloaded. The trust prompt showed the speech engine and data folder lines. The
data folder was created with mode `0700`. `/v1/core/speech/status` named the engine, and posting a
5.8 s clip to `/v1/core/speech/transcribe` returned the right text in 215 ms. A dictionary entry
typed in the settings page was applied. No transcript text appeared in the session's logs or
databases. The download itself, the mic, and the phone weren't tried.
