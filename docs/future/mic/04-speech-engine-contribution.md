# Phase 4: the speech engine contribution

Date: November 19, 2026. Status: proposed. Depends on phase 1 for the audio format.

## Goal

A loaded plugin declares a speech engine in its manifest. The agents plugin posts recorded audio to
it and gets text back. No plugin code runs in the renderer for this, and no plugin sees the mic.

## Why a manifest contribution

A capability is the obvious seam, but `scopeCapabilities` in
`packages/node-core/src/server/plugins/permissions.ts` only lets a plugin provide IDs under its own
name. The agents plugin would have to know the engine plugin's ID, so a second engine could never
plug in.

`agentTools` and `contextSections` already solve the same problem for loaded plugins. Each names a
route in the plugin's own namespace, and the host turns the descriptor into a registration
(`packages/node-core/src/server/pluginHost/runtimeContributions.ts`,
[loaded tools](../../agent-tools/loaded-tools.md)). A speech engine follows that pattern.

## The contract

In the manifest:

```json
{
  "contributions": {
    "speechEngines": [
      {
        "id": "local",
        "label": "On-device speech",
        "transcribe": "/v1/p/voice/transcribe",
        "status": "/v1/p/voice/status",
        "settings": "settings"
      }
    ]
  }
}
```

- `transcribe` gets a POST. The body is a WAV file, 16 kHz, mono, 16-bit, unless phase 1 picks
  otherwise. Query fields: `language` when the person chose one. It answers `{ text }`, with `text`
  at most 64 KiB.
- `status` gets a GET. It answers `{ state, detail? }`, where `state` is `ready`, `needs-setup`,
  `preparing`, or `failed`. `detail` is one line of text for the person.
- `settings` names a `settings` surface in the same manifest, so the composer can send someone there
  when the state is `needs-setup`.
- At most two engines per plugin. Every path must sit under `/v1/p/<pluginId>/`, as for every other
  descriptor.

On the agents Node side:

- `POST /v1/agents/speech/transcribe?taskId=…` takes the WAV body, checks the size, and posts it to
  the active engine's `transcribe` route through the plugin host. It answers `{ text }`.
- `GET /v1/agents/speech/status` answers the active engine's label and state, or `{ engine: null }`
  when none is installed.
- With two engines installed, the person picks one in the agents settings. Until they do, the first
  one by plugin ID is used.

## Limits

- Audio body at most 10 MiB, which is about 5 minutes of 16 kHz 16-bit mono. The composer stops at
  that length.
- The engine route gets 30 s before the host gives up and answers a timeout.
- The host never retries a transcribe call.
- Neither the host nor the agents plugin logs, records, or audits the audio or the text. Telemetry
  may record the duration, the byte count, the time taken, and the outcome.

## Verify before building

- Whether the plugin host's route fetch passes a binary body through to a loaded plugin untouched.
  `pluginRpc.ts` reads request bodies as `Uint8Array`, which suggests it does.
- How `sendForm` or a raw bytes POST reaches an agents route from the renderer, and whether a phone
  client over the relay has a lower body cap.
- Whether the trust prompt should list a speech engine. It receives audio only when someone presses
  the button, but the person installing it should still see "Turns your dictation into text".

## Done when

- A fixture plugin that answers `{ text: "hello" }` is called by the agents route and its answer comes
  back.
- A path outside the plugin's namespace is refused at manifest parse.
- Disabling the plugin makes `status` answer `{ engine: null }` within one status read.
- A body over 10 MiB is refused with 413 before any plugin sees it.

## Owning pages

Add a section to [contributions](../../plugin-authoring/contributions.md), and a page beside
[loaded tools](../../agent-tools/loaded-tools.md) for the route shapes.

## Checkpoint

Not run.
