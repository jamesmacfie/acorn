# Phase 3: sound

Design, 2026-09-02. Not started. Depends on phase 2 (the `sound` toggle exists).

## Goal

An unseen `blocked` or `error` edge plays one two-note chime and an unseen `finished` edge plays
another, on the desktop through WebAudio and on the terminal client through BEL. Seen edges are
silent. No audio file ships.

## Why

The user asked for an audible ping. gouda's argument in [references.md](./references.md) is the
reason it is a separate channel from the system notification: the sound is for when you are not
looking at the screen at all, and the OS notification's own sound option is unreliable across
platforms (verne, emdash, and orca all work around it).

## Requirements

1. `packages/client-core/src/features/notifications/chime.ts` (new) exports `CHIMES`, a record of
   two tone schedules as plain data (`{ frequencyHz, startMs, durationMs, gain }[]`), one named
   `attention` and one named `done`, and `playChime(name, audio: AudioContextLike)`. The schedules
   are data so a test can assert them without an `AudioContext`.
2. The `attention` chime is two rising notes and the `done` chime two falling ones, each under
   400 ms total, at a gain that reads as a notification and not as an alarm. Tune by ear and record
   the numbers in the file.
3. An `AudioContext` is created lazily on first play and resumed on the first user gesture if the
   browser suspended it, so the first unseen edge after boot sounds rather than warming up the
   context and playing nothing.
4. A sound sink is added to `deliver`'s sink list: fires when `settings.sound` is on and the edge
   is unseen; picks `attention` for `blocked` and `error`, `done` for `finished`.
5. The terminal client's sound sink writes `\x07` (BEL) to stdout when `ACORN_TUI_NOTIFY` is
   `bell` or `both`. The host terminal decides what a bell is; Warp, iTerm2, and Kitty can all turn
   it into a visual or an OS notification of their own.
6. No mp3, wav, or other asset is added to any package.

## Design notes

**Why synthesised.** [refused.md](./refused.md) § Bundled sound files. Two oscillators and a gain
envelope are twenty lines and have no format, player, or bundling question.

**Why two chimes and not three.** `error` and `blocked` both mean "come here". A third tone is a
thing to learn for a distinction the notification title already draws.

**Why the terminal client uses BEL.** A Node process has no audio device it can reach portably. BEL
is the one sound every terminal understands, and it is also the signal Warp and iTerm2 already turn
into badges and OS notifications for a long-running command. Phase 5 handles the richer OSC
sequences.

## Files

- `packages/client-core/src/features/notifications/chime.ts` (new): schedules and player.
- `packages/client-core/src/features/notifications/deliver.ts` (new in phase 1): the sound sink.
- `apps/tui/src/kit/notify.ts` (new in phase 5; the BEL write can land there or in a small `bell.ts` here).

## Tests

- `packages/client-core/src/features/notifications/chime.test.ts` (new): both schedules have two
  notes, total under 400 ms, gain under 0.5; `playChime` against a fake context schedules the right
  frequencies at the right offsets.
- `deliver.test.ts`: the sound sink is called for an unseen `blocked` and not for a seen one, and
  not at all when `sound` is off.

## Acceptance

- Requirements 1 to 6 hold.
- Pressing **Send a test notification** with **Play a sound** on plays the `attention` chime; off
  plays nothing.
- Every existing test passes.

## Doc moves when it ships

The owning doc phase 6 chooses gains a paragraph on the two chimes and the BEL rule. This file
shrinks to a pointer.
