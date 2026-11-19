# Voice input for the agent composer

Date: November 19, 2026. Status: proposed. No phase started.

## What this is

Press a button or a shortcut in the agent composer, speak, and the words land in the draft at the
cursor. A small pill shows that the mic is live while you talk. Transcription runs on the Node, on a
speech model you agree to download in Settings. Nothing goes to a cloud service.

The bar is the dictation app James already uses, Voice Type. Parrot, an open-source app that does
the same job, pastes text 200 to 300 ms after the key is released. That is the target to beat.
[Research](./research.md) covers the eight open-source apps this plan learned from.

## Why it isn't only a plugin

A loaded plugin can't do this today, for five reasons found on November 19, 2026:

1. Tree code, including anything in the `agents:composer-actions` slot, runs in a Web Worker with no
   `getUserMedia`. Trees also drop key and pointer handlers, so there is no hold-to-talk
   (`docs/plugin-authoring/the-client-half.md`).
2. Plugin frames have no `allow="microphone"` (`packages/client-core/src/host/frames/PluginFrame.tsx`).
   Their policy also blocks WebAssembly and workers, so a model can't run in a frame
   (`apps/desktop/src-tauri/src/plugin_scheme.rs`).
3. The desktop app has no microphone usage string and no audio-input entitlement
   (`apps/desktop/src-tauri/entitlements.plist`), so macOS refuses the mic.
4. `agents:composer-actions` declares no owner actions, so a contributor can't write into the draft.
   A plugin overlay is a modal dialog with a backdrop, not a pill.
5. A loaded plugin's worker may write only its SQLite files (`packages/node-core/src/server/plugins/isolation.ts`),
   so it has nowhere to keep a 450 to 700 MB model.

So the work splits. The agents plugin owns the mic, the button, the shortcut, the pill, and the
insert. A separate loaded plugin owns the speech engine: the model download, the consent, the
engine process, and its settings page. Audio reaches the plugin only as bytes posted to a route it
declared, after the person pressed the button.

## Decisions to confirm with James

These are the plan's defaults. Confirm or change each one before phase 4 starts.

| Decision | Default in this plan |
| --- | --- |
| Where mic capture lives | The agents plugin's composer, in the main renderer. Plugin frames never get the mic. |
| How an engine plugs in | A new manifest contribution, `speechEngines`, that names a route in the plugin's own namespace, the way `agentTools` does. |
| Where the engine plugin lives | Its own repository, `../acorn-voice`, as TruffleHog and the disk cleanup plugin do. Plugin ID `voice`. |
| First engine | sherpa-onnx running Parakeet TDT 0.6B v2, int8, as a long-running local process. Phase 1 can overturn this. |
| Shortcut behaviour | Hold to talk, release to stop. A tap shorter than 300 ms turns on hands-free mode until the next press. |
| Cloud transcription | Out of scope. |
| Clean-up by a language model | Out of scope. A personal dictionary of replacements is in scope. |
| Terminal client | No voice input. A terminal has no mic API. |

## Rules no phase may break

| Rule | Why |
| --- | --- |
| No plugin frame or tree gets microphone access. | Any plugin with a frame could otherwise listen. Capture stays in host code that the person starts by hand. |
| The mic is live only while the pill shows. | The person must always be able to see that they are being recorded. |
| Transcript text and audio are never written to logs, telemetry, or the audit trail. | Dictation is often private. Parrot and Handy make the same promise. |
| Audio is never kept after its transcription returns. | Nothing asks for a recording history. |
| Voice input never sends a message. It only edits the draft. | The person reads what the model heard before the agent does. |
| A model downloads only after the person agrees to its name and size in Settings. | Hundreds of megabytes is not a silent download. |
| `/v1` routes don't change meaning in place. | Older clients keep working ([versioning](../../api-reference/versioning.md)). |

## The phases

| Phase | What it delivers | Depends on |
| --- | --- | --- |
| [1. Engine spike](./01-engine-spike.md) | A measured choice of engine and model, against Voice Type, on James's Mac | Nothing |
| [2. Desktop microphone](./02-desktop-microphone.md) | The desktop app may use the mic from its own renderer, and plugin frames still can't | Nothing |
| [3. Plugin data folder](./03-plugin-data-folder.md) | A permission that gives a loaded plugin one folder of its own to write | Nothing |
| [4. Speech engine contribution](./04-speech-engine-contribution.md) | The `speechEngines` manifest key, and an agents route that posts audio to the active engine | Nothing to build, phase 1 to settle the audio format |
| [5. Composer voice input](./05-composer-voice.md) | The mic button, shortcut, pill, capture, and insert | Phases 2 and 4 |
| [6. The voice plugin](./06-voice-plugin.md) | The engine plugin: consent, download, the engine process, settings, and dictionary | Phases 1, 3, and 4 |

Phases 1, 2, and 3 can run side by side. Phase 1 should finish first in practice. If no local engine
is close to Voice Type, stop and rethink before building anything else.

## Owning documents to update

| Contract | Owning page |
| --- | --- |
| The mic entitlement and who may request the mic | [The shell](../../shell.md) and [origins](../../shell/origins.md) |
| The data folder permission | [Permissions](../../plugin-authoring/permissions.md) |
| The `speechEngines` contribution | [Contributions](../../plugin-authoring/contributions.md), with a page beside [loaded tools](../../agent-tools/loaded-tools.md) |
| Voice input in the composer | [The composer](../../managed-agents/composer.md) |
| The voice plugin | Its own repository's README |

## Rules for the work

- Run `pnpm lint` and the tests for each package you touch, and `pnpm test` before a phase is done.
- Each phase ends with a checkpoint someone runs by hand and records, with the date, in the phase
  file. A skipped checkpoint is written down as skipped, with the reason.
- Settle each phase's **Verify before building** items before writing its code, and record the answer
  in the phase file.
- When a phase lands, cut its file down to what is left and point at the owning pages.
