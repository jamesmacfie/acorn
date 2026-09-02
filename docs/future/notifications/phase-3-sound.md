# Phase 3: sound

Shipped 2026-09-02. An unseen `blocked` or `error` notice plays a rising two-note chime and an
unseen `finished` one plays a falling chime, on the desktop through WebAudio; on the terminal client
the same notice writes BEL and lets the emulator decide what a bell is. No audio file ships. Where
each part landed:

- `packages/client-core/src/features/notifications/chime.ts` holds `CHIMES` — two schedules of
  `{ frequencyHz, startMs, durationMs, gain }` notes, `attention` rising E5 → A5 and `done` falling
  back, both inside 320 ms at gain 0.1 to 0.12 — plus `playChime`, the lazy `AudioContext`, and
  `initSoundNotices`, which registers the sink and resumes a suspended context on the first click or
  keypress.
- `apps/desktop/src/client/App.tsx` calls `initSoundNotices` on mount, beside `initWorkflowNotices`.
- `apps/tui/src/kit/bell.ts` holds `notifyMode`, which reads `ACORN_TUI_NOTIFY` as `off`, `bell`,
  `terminal`, or `both` and defaults to `both`, and `initBellNotices`, which writes BEL for every
  unseen notice. `apps/tui/src/main.tsx` calls it after `watchPluginChanges`.
- The switch is `settings.sound`, read by the sink itself through `readNotificationSettings`. The
  seen rule needs no repeating: `deliver` only ever hands a sink an unseen notice.

## Where the build departed from the requirements

**The sink reads the settings, the context does not carry them** (requirement 4). A `NoticeSink`
takes a `Notice` and nothing else, so `soundSink` calls `readNotificationSettings()` itself. That is
the same value `defaultDeliveryContext` reads, and it keeps the sink registry from having to grow a
second argument for one channel.

**The chime tests live in `chime.test.ts`, not `deliver.test.ts`** (the tests section). The gate's
own tests already prove a sink fires for an unseen edge and stays quiet for a seen one, with a
recording sink that has no settings of its own. What was left to prove is the sound-specific half —
which chime a kind picks, and silence when `sound` is off — and that reads better next to the
schedules it asserts against.

**`bell.ts`, not `notify.ts`** (the files section, which offered either). Phase 5 owns
`apps/tui/src/kit/notify.ts` (new) and the OSC sequences; `notifyMode` lives in `bell.ts` for now
because it is the switch both files read, and phase 5 can move or re-export it.

## Doc moves when it ships

The owning doc phase 6 chooses gains a paragraph on the two chimes and the BEL rule. This file then
goes with the folder.
