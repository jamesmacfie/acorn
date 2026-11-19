# Speech engines

A speech engine turns what someone dictates in the agent composer into text. A loaded plugin
declares one in its manifest, and the Node calls the engine's routes. The plugin never touches the
microphone: the app's own renderer records, and audio reaches the plugin only after the person
pressed record ([voice input](../managed-agents/composer.md#voice-input)).

`packages/node-core/src/server/pluginHost/speechEngines.ts` holds the declared engines, and
`packages/node-core/src/server/routes/speech.ts` serves the core routes.

## The manifest

```json
{
  "contributions": {
    "speechEngines": [
      {
        "id": "local",
        "label": "On-device speech",
        "transcribe": "/v1/p/voice/transcribe",
        "status": "/v1/p/voice/status",
        "settings": "voice-settings"
      }
    ]
  }
}
```

- `id` is lowercase snake case. `label` is what the composer calls the engine, at most 60 characters.
- `transcribe` and `status` must sit under `/v1/p/<pluginId>/`, and the manifest needs a `node` entry.
- `settings` is optional. It names a `settings` surface in the same manifest, which **Set up voice
  input** opens.
- A plugin declares at most two engines.

The trust prompt shows "Turns your dictation into text" under what the plugin provides. Agents can't
call either route: the host reserves both, as it does for an agent tool's handler.

## The engine's routes

`transcribe` gets a POST whose body is a WAV file: 16 kHz, mono, 16-bit PCM, with silence already
trimmed from both ends. Answer `{ "text": "…" }`, at most 64 KiB. To refuse, answer any error status
with the usual `{ "error": { "message" } }` envelope, and the composer shows the message. The host
waits 30 seconds and never retries.

`status` gets a GET. Answer `{ "state", "detail"? }`:

| `state` | What the composer shows |
| --- | --- |
| `ready` | The mic button and the shortcut |
| `needs-setup` | **Set up voice input**, which opens `settings` |
| `preparing` | The mic button and the shortcut. Recording works, and the pill shows a loader until a status read answers `ready` |
| `failed` | The mic button, with `detail` as its tip |

`detail` is one line for the person, at most 300 characters. The host waits 5 seconds for an answer,
and calls a silent or unreadable engine `failed`. The composer reads status when it mounts and each
time the message box takes focus, so it's a good moment to load a model. While recording to a
`preparing` engine, it reads status every 500 ms.

## The core routes

Both are device-only, so a task token is refused.

- `GET /v1/core/speech/status` answers `{ "engine": null }` when no engine runs, or the active
  engine's `pluginId`, `id`, `label`, `settings`, `state`, and `detail`.
- `POST /v1/core/speech/transcribe` takes a multipart form with the recording as its `audio` part. It
  answers `{ "text" }`. A recording over 10 MiB, about 5 minutes, gets 413 before any plugin sees it.
  A missing engine gets 404, a slow one 504, and an engine error 502 with the engine's message.

The active engine is the first one the only engine plugin declares. When two or more plugins offer
an engine, neither gets audio: status answers `failed` naming them, and `transcribe` answers 409. That
way a newly installed plugin can't take dictation from the one the person set up. There's no picker
yet. Disabling the plugin removes its engine at the next status read.

## Privacy

Neither the host nor the composer logs, audits, or keeps the audio or the text. The dispatch span
records the route, the status, and the time taken. The composer logs one line per dictation with
three timings: press to first sound, release to text, and the length of the audio.
