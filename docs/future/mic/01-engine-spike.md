# Phase 1: pick the engine by measuring it

Date: November 19, 2026. Status: partly run. Depends on nothing.

## Goal

Find out whether a local engine is close enough to Voice Type before building anything. This phase
writes no Acorn code. It produces a table of numbers and one decision.

## Steps

1. Record 10 dictations of the kind you give agents, 5 to 30 s each, as 16 kHz mono WAV. Include
   project words such as pnpm, Tauri, worktree, Drizzle, and a task or file name.
2. Dictate the same 10 into Voice Type and save what it typed. That is the reference.
3. Run each candidate on the same files, with the model already loaded, and time from the end of the
   audio to the text:
   - sherpa-onnx offline WebSocket server, Parakeet TDT 0.6B v2 int8.
   - sherpa-onnx with Parakeet v3, for the multilingual case.
   - transcribe.cpp `transcribe-cli` with a Parakeet GGUF on Metal. Subtract the model load, because
     a real build keeps it resident.
   - FluidAudio's CLI with Parakeet v2 on the Neural Engine.
4. Count word errors against what you meant to say, not against Voice Type.
5. If the Node sometimes runs on a Linux machine, such as the hermes-acorn VM, repeat the
   sherpa-onnx run there.

Keep the recordings, the scripts, and the binaries outside the repository, for example under
`~/.cache/acorn-voice-spike`.

## Results

Partly run on November 19, 2026, on James's M2 Pro, with clips spoken by macOS `say` rather than
recorded. Voice Type, real recordings, transcribe.cpp, FluidAudio, and Parakeet v3 weren't run.
The scripts and clips are in `~/.cache/acorn-voice-spike`.

| Engine and model | Time to text, model loaded | Word errors | Notes |
| --- | --- | --- | --- |
| Voice Type | Not measured | Not measured | |
| sherpa-onnx 2.0.1 Node addon, Parakeet v2 int8, 4 threads | About 160 ms for a 6 s clip, 356 ms for a 12 s clip | 4 in 6 clips | "Tori" for Tauri, "root" for route twice, "work tree" for worktree. A dictionary fixes all four |
| sherpa-onnx, Parakeet v3 int8 | Not measured | Not measured | |
| transcribe.cpp, Parakeet GGUF, Metal | Not measured | Not measured | |
| FluidAudio, Parakeet v2 | Not measured | Not measured | |

The model loads in under a second from the disk cache and in about 3 s cold. 2 threads took about
240 ms on a 6 s clip, and 8 threads about 140 ms. Under heavy load from a test run, the same clips
took 400 to 1,300 ms.

## Decision rule

- Choose the simplest engine within 150 ms and two word errors of the best one. sherpa-onnx wins
  ties, because it runs on every Node platform from one binary family.
- If nothing comes within 500 ms of the end of the audio on a 10 s clip, stop here. Talk to James
  before phase 4.
- Record the audio format the winner wants. Phase 4 fixes it in the contract.

## Verify before building

- The sherpa-onnx Node addon from npm loads and runs from a folder Node wrote, with no quarantine
  prompt. It's a Node-API addon, so it runs on Node 24 and 26 alike. Answered November 19, 2026.
- Licences: sherpa-onnx is Apache-2.0. Parakeet TDT 0.6B v2 is CC-BY-4.0, which needs attribution, so
  the settings page names NVIDIA. The ONNX export's repository on Hugging Face carries no licence of
  its own. GGUF wasn't checked.

The audio format the winner wants: 16 kHz, mono, 16-bit WAV, as phase 4 assumed.

## Checkpoint

Partly run, November 19, 2026. The decision rule passes for sherpa-onnx on synthetic speech: well
inside 500 ms on a 10 s clip. Still to do: dictate the 10 real clips into Voice Type and into the
voice plugin, and count word errors.
