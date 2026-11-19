# Phase 4: the speech engine contribution

Date: November 19, 2026. Status: built and tested.

The contract is in [speech engines](../../agent-tools/speech-engines.md), and the manifest key in
[contributions](../../plugin-authoring/contributions.md).

## Where it differs from the plan

- The routes are core routes, `/v1/core/speech/status` and `/v1/core/speech/transcribe`, not agents
  routes. The agents plugin has no way to call another plugin's route, and core already dispatches
  to plugin routes for agent tools and context sections.
- The composer posts a multipart form with an `audio` part, through the same `sendForm` an attachment
  upload uses. Core sends the engine the bare WAV.
- No engine picker yet. With one engine plugin its first engine is used. With two, dictation is off
  and says which plugins clash, rather than picking one silently.
- The handlers load on first use, to keep the Node's startup code small.

## Answers found while building

- The in-process dispatch carried only JSON bodies. It now takes bytes and a content type.
- The trust prompt shows "Turns your dictation into text" under what the plugin provides.
- Not checked: whether the phone's relay caps a request body below 10 MiB.

## Checkpoint

`routes/speech.test.ts` covers a fixture engine's answer, the 413 before dispatch, an engine error,
an agent's refusal, and the engine leaving when its plugin does. `manifest.test.ts` covers the
manifest rules.
