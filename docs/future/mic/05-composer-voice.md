# Phase 5: voice input in the composer

Date: November 19, 2026. Status: built, not tried with a real mic.

What the person sees is in [the composer](../../managed-agents/composer.md#voice-input). The code is
in `plugins/agents/src/client/composer/`: `ComposerVoice.tsx` for the button and the pill,
`dictation.ts` for the states, `voiceRecorder.ts` for the mic, `voiceShortcut.ts` for the chord, and
`voiceAudio.ts` for the WAV, the silence trim, and the insert.

## Answers found while building

- The chord is Cmd+Shift+L. A chord's key must be one character, so Space isn't possible, and the
  keymap reads `event.key`, which Option changes on a Mac, so an Alt chord wouldn't fire there.
- The keymap stops the key event when it matches, so the field types nothing.
- On macOS, releasing a key while Command is down sends no keyup for it. Any keyup, or the window
  losing focus, ends a hold, so letting go of Command is enough.
- Capture uses a `ScriptProcessorNode` and resamples once with an `OfflineAudioContext`. That needs no
  worklet module, so it passes the renderer's worker policy. It's deprecated, which the code says.
- Command IDs are unique, so the shortcut is registered once and goes to the composer whose field has
  focus, or to the only one on screen.

## What's left

- In `pnpm dev:agent`, with the voice plugin installed, dictate into a session and check the mic
  indicator goes off afterwards.
- Try the button on the phone.

## Checkpoint

Partly run in `pnpm dev:agent`, November 19, 2026: with the voice plugin installed, the composer
shows the mic button beside **Attach**. The button wasn't pressed, because the macOS mic prompt
needs a person. Unit tests cover the WAV encoder, the silence trim, the insert, the tap and hold timing, and
the dictation states.
