# Research: open-source dictation apps

Date: November 19, 2026. Read for ideas. Don't copy code from a GPL or PolyForm repository.

Each repository is cloned under `references/`, which Git ignores. Recheck a repository before
relying on a detail here, because these projects change weekly.

## The apps

| App | What it is | Engine | Licence |
| --- | --- | --- | --- |
| [VoiceInk](https://github.com/Beingpax/VoiceInk) | macOS dictation, the open Superwhisper | FluidAudio (Parakeet), whisper.cpp, transcribe.cpp | GPL-3.0 |
| [Muesli](https://github.com/Muesli-HQ/muesli) | macOS dictation and meeting notes, with a CLI for agents | FluidAudio, WhisperKit, Apple Speech, and more | MIT |
| [OpenOats](https://github.com/yazinsai/OpenOats) | macOS meeting recorder | FluidAudio (Parakeet v3), WhisperKit (large-v3-turbo) | MIT |
| [quill](https://github.com/humanitas-labs/quill) | macOS meeting recorder | FluidAudio (Parakeet v2) | MIT |
| [parrot](https://github.com/humanitas-labs/parrot) | Minimal macOS hold-to-talk dictation, quill's sibling | WhisperKit, with Parakeet and Apple Speech planned | MIT |
| [Biscotti](https://github.com/scosman/Biscotti) | macOS meeting transcription | Argmax (WhisperKit) | PolyForm Perimeter |
| [Handy](https://github.com/cjpais/Handy) | Cross-platform dictation, Tauri like Acorn | transcribe.cpp (GGUF models) | MIT |
| [OpenWhispr](https://github.com/OpenWhispr/openwhispr) | Cross-platform dictation, Electron | sherpa-onnx (Parakeet), whisper.cpp server | MIT |

The first five come from James's GitHub stars. Handy, OpenWhispr, and parrot were added because they
are the closest matches to this plan.

## Models

Parakeet TDT 0.6B from NVIDIA is the model nearly every app defaults to. v2 is English only and v3
covers 25 European languages. Whisper large-v3-turbo is the usual fallback for other languages.

Sizes from Handy's catalogue (`references/Handy/src-tauri/src/managers/model.rs`):

| Model | Size |
| --- | --- |
| Parakeet v2 or v3, GGUF | About 450 MB |
| Moonshine V2 streaming, tiny to medium | 31 to 192 MB |
| Whisper large-v3-turbo | About 1.5 GB |
| Canary 1B v2 | About 690 MB |

Muesli also offers Apple's on-device speech recognition on macOS 26 and later. It needs no download
the app manages, because macOS owns the language assets.

## Engines that run outside a Swift app

Acorn's Node is a Node.js process, so the engine has to be a separate program it can start.

| Engine | How it runs | Fit for Acorn |
| --- | --- | --- |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Prebuilt binaries, including an offline WebSocket server that keeps the model loaded. CPU on macOS, Linux, and Windows. | Best first choice. OpenWhispr runs it from Node (`references/openwhispr/src/helpers/parakeetWsServer.js`). |
| [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) | A C++ library and `transcribe-cli` with Metal, Vulkan, and CPU builds. Takes 16 kHz mono WAV. No server mode found. | Faster on a Mac GPU, but a one-shot CLI reloads the model each call. It needs a small resident wrapper. |
| [FluidAudio](https://github.com/FluidInference/FluidAudio) | Swift package running Parakeet on the Apple Neural Engine, with a `fluidaudio` CLI. First load compiles for the Neural Engine, about 15 s, then about 2 s. | Fastest on Apple Silicon. Needs a Swift helper Acorn builds and signs. macOS only. |
| whisper.cpp | `whisper-server` keeps a Whisper model loaded behind HTTP. | Whisper is slower than Parakeet for English dictation. Keep as the multilingual option. |
| Muesli's CLI | `muesli-cli transcribe FILE --model NAME`, inside Muesli.app | Only works if Muesli is installed. Not a dependency to take. |

## How the fast apps feel fast

- **The model stays loaded.** Parrot loads once at start. Handy keeps one engine process alive per
  model and unloads it when the model changes. A cold load costs seconds, a warm call costs tens of
  milliseconds.
- **Silence is trimmed before decoding.** Parrot's `SilenceTrimmer.swift` cuts leading and trailing
  silence. Handy runs a voice activity detector (Silero) on the stream.
- **The engine is its own process.** Handy's `engine_supervisor` restarts a crashed or hung engine
  and falls back to CPU if the GPU caused it. The app never sees the crash.
- **Latency is measured every time.** Parrot's `LatencyLog.swift` writes one line per dictation:
  press to first sample, release to text, and each stage. It never logs the words.

## Polish worth copying

- Hold to talk, release to stop. Parrot ignores a tap under 0.3 s. Muesli's double tap starts
  hands-free mode.
- A small pill near the bottom of the screen while the mic is live.
- A personal dictionary of word replacements. Parrot keeps a plain-text table in
  `~/.config/parrot/dictionary`. Muesli's entries carry a match threshold, such as
  `{ "word": "museli", "replacement": "muesli", "matching_threshold": 0.85 }`.
- Optional filler-word removal.
- Handy runs an executable hook to rewrite text before it pastes. A plugin route could play the same
  role later.

## What doesn't apply to Acorn

Pasting into other apps, clipboard restore, global hotkeys through an event tap, and Accessibility
permission. Acorn writes into its own composer, so none of that machinery is needed. Meeting
recording, system audio capture, and speaker separation are out of scope too.
