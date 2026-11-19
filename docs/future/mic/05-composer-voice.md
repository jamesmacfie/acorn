# Phase 5: voice input in the composer

Date: November 19, 2026. Status: proposed. Depends on phases 2 and 4.

## Goal

The agent composer gets a mic button and a shortcut. While you speak, a pill shows that the mic is
live. When you stop, the text goes into the draft at the cursor.

## What the person sees

- A mic button in the composer's action bar, beside **Attach**
  (`plugins/agents/src/client/composer/AgentComposer.tsx`). It only appears when
  `GET /v1/agents/speech/status` names an engine.
- If the engine says `needs-setup`, the button reads **Set up voice input** and opens the engine's
  settings page.
- Hold the shortcut to talk and release to stop. A tap shorter than 300 ms starts hands-free mode,
  which runs until the next press or a click on the pill.
- The pill sits above the composer while the mic is live. It shows a level meter and the elapsed
  time, and it has a stop button. While the engine works, it shows **Transcribing**.
- The text goes in at the cursor, with a space on either side where needed. The cursor ends after it.
  Nothing is sent.
- On failure, the pill shows one line saying what went wrong, such as "The microphone is off for
  Acorn in System Settings" or "The speech engine didn't answer in 30 s". Escape dismisses it.

## Changes

1. A `useVoiceInput` hook in the composer folder. It opens the mic on start, records PCM, stops,
   builds a 16 kHz mono WAV, and posts it to `/v1/agents/speech/transcribe`.
2. Capture with an `AudioWorklet` that downmixes and resamples to 16 kHz, or record at the device rate
   and resample once on stop with an `OfflineAudioContext`. Pick the simpler one that passes the
   desktop worker policy (`worker-src 'self' blob:` in `app_scheme.rs`).
3. Trim silence from both ends before posting, with a simple energy threshold, as parrot's
   `SilenceTrimmer.swift` does.
4. Stop at 5 minutes and say so in the pill.
5. Insert with the existing caret-aware helper (`insertContextToken` and `caret()` in
   `AgentComposer.tsx`), so it lands where the cursor is at the moment the text arrives.
6. Register the shortcut the same way `TerminalComposerShortcut.tsx` registers `alt+e`. The command
   starts recording, and the composer listens for that key's `keyup` to stop it.
7. Release the mic track the moment recording stops, so the system's mic indicator goes off.
8. Log one line per dictation with timings only: press to first sample, release to text, audio
   length. Never the text.

## Edge cases

- The person switches session or closes the pane while transcribing. The text goes into the draft of
  the session it was started in, which the composer already keeps per session.
- The person types while transcribing. The text goes in at the cursor at arrival time and doesn't
  replace what they typed.
- Two composers on screen. Only the focused one listens to the shortcut.
- The phone. `getUserMedia` works in mobile Safari, so the button can show there too. Check it in
  phase 6's acceptance. The shortcut doesn't apply.
- The terminal client. No button and no shortcut.

## Verify before building

- A default chord that is free in the keymap and works with a hold. A plugin shortcut must include
  meta, ctrl, or alt, but this one is the agents plugin's own registration.
- Whether the keybinding system eats the `keyup` the composer needs.
- How a focused textarea treats the chord, so it doesn't type a character.

## Done when

- Unit tests cover the WAV encoder, the silence trimmer, the hold and tap timing, and the insert at
  the cursor with text on either side.
- In `pnpm dev:agent`, with a fixture engine from phase 4, a dictation lands in the draft and the mic
  indicator goes off afterwards.

## Owning pages

Add a **Voice input** section to [the composer](../../managed-agents/composer.md).

## Checkpoint

Not run.
